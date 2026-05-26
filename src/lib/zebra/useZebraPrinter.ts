'use client';

// Hook que gerencia conexão WebUSB com impressora(s) Zebra (multi-device).
//
// Modelo:
//   - O hook lista TODAS as impressoras pareadas (`devices`).
//   - Usuário escolhe a "ativa" via `selectDevice(serial)` — persiste em localStorage.
//   - Singleton `activeHandle` reusa o open() entre chamadas; ao trocar selected,
//     o handle anterior é liberado e o novo é aberto on-demand.
//
// Restrições WebUSB:
//   - Só funciona em secure context (HTTPS ou localhost). Hostnames .test exigem
//     chrome://flags/#unsafely-treat-insecure-origin-as-secure no dev.
//   - Suporte: Chromium-based (Chrome, Edge, Opera, Arc). Firefox/Safari NÃO suportam.
//   - Pareamento manual via navigator.usb.requestDevice (Chrome abre diálogo nativo).
//
// Vendor IDs Zebra conhecidos: 0x0A5F. Filtro fallback aceita USB Printer Class (0x07).

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildZpl, type ZebraLabelInput } from './zpl';

const ZEBRA_VENDOR_ID = 0x0a5f;
const PREF_KEY = 'zebra:preferred-serial';

// ════════════════════════════════════════════════════════════
// TIPOS WebUSB (subset do que usamos — lib.dom não tem por padrão)
// ════════════════════════════════════════════════════════════

interface USBEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: string;
}
interface USBAlternateInterface {
  interfaceClass: number;
  endpoints: USBEndpoint[];
}
interface USBInterface {
  interfaceNumber: number;
  alternates: USBAlternateInterface[];
}
interface USBConfiguration {
  configurationValue: number;
  interfaces: USBInterface[];
}

interface USBDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  serialNumber?: string;
  manufacturerName?: string;
  configuration: USBConfiguration | null;
  configurations: USBConfiguration[];
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ bytesWritten: number; status: string }>;
  /** Remove permanentemente a permissão WebUSB (Chrome 100+). Opcional. */
  forget?(): Promise<void>;
}

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
}

interface USB {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
  addEventListener(type: 'connect' | 'disconnect', listener: (e: Event) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (e: Event) => void): void;
}

declare global {
  interface Navigator {
    usb?: USB;
  }
}

// ════════════════════════════════════════════════════════════
// TIPOS PÚBLICOS
// ════════════════════════════════════════════════════════════

/** Info segura pra UI (sem expor o USBDevice cru). */
export interface ZebraDeviceInfo {
  /** Identificador estável da impressora: usa serialNumber se houver, fallback "vid:pid". */
  id: string;
  /** Apenas o serialNumber (pode ser undefined em devices sem serial). */
  serialNumber?: string;
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  /** Rótulo amigável pra mostrar: "Zebra ZD420 #ABC123" ou similar. */
  label: string;
  /** É a impressora Zebra (vendorId match)? */
  isZebra: boolean;
}

export type ZebraStatus = 'idle' | 'connecting' | 'connected' | 'printing' | 'error';

export interface UseZebraPrinterReturn {
  /** Suporte a WebUSB no navegador atual + ambiente (secure context). */
  supported: boolean;
  /** Lista de TODAS impressoras pareadas na origem (atualizada em connect/disconnect). */
  devices: ZebraDeviceInfo[];
  /** ID da impressora selecionada (persistido em localStorage). null = nenhuma. */
  selectedId: string | null;
  /** Atalho: info do device selecionado (ou null). */
  selectedDevice: ZebraDeviceInfo | null;
  /** Indica se há ao menos um device pareado. */
  paired: boolean;
  /** Estado atual (idle/connecting/connected/printing/error). */
  status: ZebraStatus;
  /** Última mensagem de erro (limpa ao chamar qualquer ação). */
  error: string | null;
  /** Dispara o diálogo do browser pra parear nova impressora. */
  connect: () => Promise<void>;
  /** Libera o device atual (próximo print reabre). */
  disconnect: () => Promise<void>;
  /**
   * Esquece UMA impressora pelo id. Chrome 100+: remove a permissão; antigos: só fecha handle.
   * Se for a selecionada, limpa o selectedId.
   */
  forgetDeviceById: (id: string) => Promise<{ forgotten: boolean; supported: boolean }>;
  /** Esquece TODAS as impressoras pareadas. */
  forgetAllDevices: () => Promise<{ forgotten: number; supported: boolean }>;
  /** Conveniência: forget + abre diálogo pra parear outra. */
  switchDevice: () => Promise<void>;
  /** Seleciona qual impressora será o destino do próximo print. Persiste em localStorage. */
  selectDevice: (id: string | null) => void;
  /** Constrói ZPL e envia pra impressora selecionada. */
  print: (label: ZebraLabelInput) => Promise<void>;
  /** Envia ZPL bruto pra impressora selecionada. */
  printRaw: (zpl: string) => Promise<void>;
  /** Força refresh da lista de devices (após pareamento externo, etc.). */
  refresh: () => Promise<void>;
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function deviceId(d: USBDevice): string {
  return d.serialNumber ?? `${d.vendorId.toString(16)}:${d.productId.toString(16)}`;
}

function deviceLabel(d: USBDevice): string {
  const name = d.productName ?? `${d.manufacturerName ?? 'USB'} Printer`;
  const tail = d.serialNumber ? ` #${d.serialNumber}` : '';
  return `${name}${tail}`;
}

function toInfo(d: USBDevice): ZebraDeviceInfo {
  return {
    id: deviceId(d),
    serialNumber: d.serialNumber,
    vendorId: d.vendorId,
    productId: d.productId,
    productName: d.productName,
    manufacturerName: d.manufacturerName,
    label: deviceLabel(d),
    isZebra: d.vendorId === ZEBRA_VENDOR_ID,
  };
}

async function findOutEndpoint(device: USBDevice): Promise<{ ep: number; iface: number }> {
  if (!device.configuration) throw new Error('Device sem configuração ativa.');
  const interfaces: USBInterface[] =
    device.configuration.interfaces ?? device.configurations[0]?.interfaces ?? [];
  for (const iface of interfaces) {
    for (const alt of iface.alternates ?? []) {
      const out = alt.endpoints.find(
        (e: USBEndpoint) => e.direction === 'out' && e.type === 'bulk',
      );
      if (out) return { ep: out.endpointNumber, iface: iface.interfaceNumber };
    }
  }
  throw new Error('Endpoint OUT (bulk) não encontrado no device USB.');
}

/**
 * Abre o device com retry/backoff em "Access denied".
 *
 * Por que retry?
 *   - No Windows, o driver/spooler da Zebra costuma reclamar o device por algumas
 *     centenas de ms após um print job terminar. O próximo open() vindo do WebUSB
 *     bate em "Access denied" mesmo que o usuário tenha permissão.
 *   - Outras causas transientes: close() anterior ainda em andamento, ou device
 *     ainda completando um ciclo de reset USB pós-print.
 *   - Backoff exponencial leve resolve a maioria dos casos sem prejudicar UX.
 */
async function openWithRetry(device: USBDevice): Promise<void> {
  const delays = [0, 200, 400, 800];
  let lastErr: unknown;
  for (const wait of delays) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      await device.open();
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Só vale retry pra "access denied" / "busy". Outros erros (NotFound,
      // SecurityError, etc.) não vão melhorar com espera.
      if (!/access denied|in use|busy/i.test(msg)) throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Falha ao abrir o device USB após múltiplas tentativas.');
}

async function openAndClaim(device: USBDevice): Promise<DeviceHandle> {
  if (!device.opened) await openWithRetry(device);
  if (!device.configuration) await device.selectConfiguration(1);
  const { ep, iface } = await findOutEndpoint(device);
  try {
    await device.claimInterface(iface);
  } catch (err) {
    console.warn('[zebra] claimInterface falhou', err);
  }
  return { device, endpointOut: ep, interfaceNumber: iface };
}

async function releaseHandle(handle: DeviceHandle | null) {
  if (!handle) return;
  try {
    if (handle.device.opened) {
      await handle.device.releaseInterface(handle.interfaceNumber).catch(() => {});
      await handle.device.close().catch(() => {});
    }
  } catch {
    /* noop */
  }
}

// ════════════════════════════════════════════════════════════
// SINGLETON — um único handle ativo por vez (compartilhado entre hooks)
// ════════════════════════════════════════════════════════════

interface DeviceHandle {
  device: USBDevice;
  endpointOut: number;
  interfaceNumber: number;
}

let activeHandle: DeviceHandle | null = null;

function readSavedSelectedId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

function writeSavedSelectedId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(PREF_KEY, id);
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    /* localStorage pode estar bloqueado em sandboxed iframes */
  }
}

// ════════════════════════════════════════════════════════════
// HOOK
// ════════════════════════════════════════════════════════════

export function useZebraPrinter(): UseZebraPrinterReturn {
  const [supported, setSupported] = useState(false);
  const [devices, setDevices] = useState<ZebraDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<ZebraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Mantém o map USB cru — UI só vê ZebraDeviceInfo, mas o hook precisa do USBDevice pra operar.
  const rawDevicesRef = useRef<USBDevice[]>([]);

  const safeSet = useCallback(<T,>(setter: (v: T) => void, value: T) => {
    if (mountedRef.current) setter(value);
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.usb) return;
    const list = await navigator.usb.getDevices();
    rawDevicesRef.current = list;
    if (mountedRef.current) {
      setDevices(list.map(toInfo));
    }
  }, []);

  // Auto-select primeira impressora se nenhuma estiver selecionada e houver pareadas.
  useEffect(() => {
    if (devices.length === 0 || selectedId) return;
    // Tenta a preferência salva primeiro
    const saved = readSavedSelectedId();
    const match = saved && devices.find((d) => d.id === saved);
    if (match) {
      setSelectedId(match.id);
      return;
    }
    // Fallback: primeira Zebra encontrada, ou primeira da lista
    const first = devices.find((d) => d.isZebra) ?? devices[0];
    if (first) {
      setSelectedId(first.id);
      writeSavedSelectedId(first.id);
    }
  }, [devices, selectedId]);

  // Init: detecta suporte + carrega devices + escuta plug/unplug
  useEffect(() => {
    mountedRef.current = true;
    if (typeof navigator === 'undefined' || !navigator.usb) {
      setSupported(false);
      return () => {
        mountedRef.current = false;
      };
    }
    setSupported(true);
    // Carrega preferência salva antes do refresh.
    setSelectedId(readSavedSelectedId());
    void refresh();

    const onConnect = () => void refresh();
    const onDisconnect = () => {
      // Se o device ativo sumiu, limpa o handle. Refresh atualiza lista.
      if (activeHandle && rawDevicesRef.current.indexOf(activeHandle.device) === -1) {
        activeHandle = null;
        if (mountedRef.current) setStatus('idle');
      }
      void refresh();
    };
    navigator.usb.addEventListener('connect', onConnect);
    navigator.usb.addEventListener('disconnect', onDisconnect);
    return () => {
      mountedRef.current = false;
      navigator.usb?.removeEventListener('connect', onConnect);
      navigator.usb?.removeEventListener('disconnect', onDisconnect);
    };
  }, [refresh]);

  /** Resolve o USBDevice cru a partir do selectedId (ou primeiro Zebra/primeiro). */
  const resolveSelectedDevice = useCallback((): USBDevice | null => {
    const list = rawDevicesRef.current;
    if (list.length === 0) return null;
    if (selectedId) {
      const match = list.find((d) => deviceId(d) === selectedId);
      if (match) return match;
    }
    return list.find((d) => d.vendorId === ZEBRA_VENDOR_ID) ?? list[0];
  }, [selectedId]);

  const ensureHandle = useCallback(async (): Promise<DeviceHandle> => {
    if (!navigator.usb) throw new Error('WebUSB não suportado neste navegador.');
    const target = resolveSelectedDevice();
    if (!target) {
      throw new Error('Nenhuma impressora pareada. Adicione uma em "Configurações de impressão".');
    }
    // Reusa só se for o MESMO device E ele ainda estiver aberto.
    // O `opened` pode virar false sem nosso código tocar nele: driver Windows reivindica,
    // outra aba abre, USB reset pós-print, etc. Nesse caso o handle é stale e precisa reabrir.
    if (activeHandle && activeHandle.device === target && activeHandle.device.opened) {
      return activeHandle;
    }
    // Stale ou device diferente — libera tudo e abre do zero.
    await releaseHandle(activeHandle);
    activeHandle = null;
    activeHandle = await openAndClaim(target);
    return activeHandle;
  }, [resolveSelectedDevice]);

  const connect = useCallback(async () => {
    if (!navigator.usb) {
      safeSet(setError, 'WebUSB não suportado neste navegador.');
      safeSet(setStatus, 'error');
      return;
    }
    safeSet(setError, null);
    safeSet(setStatus, 'connecting');
    try {
      const device = await navigator.usb.requestDevice({
        filters: [{ vendorId: ZEBRA_VENDOR_ID }, { classCode: 0x07 }],
      });
      // Refresh pra incluir o novo device + auto-select
      await refresh();
      const newId = deviceId(device);
      setSelectedId(newId);
      writeSavedSelectedId(newId);
      safeSet(setStatus, 'connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /NotFoundError|No device selected/i.test(msg)
        ? 'Pareamento cancelado — nenhuma impressora selecionada.'
        : msg;
      safeSet(setError, friendly);
      safeSet(setStatus, 'error');
    }
  }, [safeSet, refresh]);

  const disconnect = useCallback(async () => {
    await releaseHandle(activeHandle);
    activeHandle = null;
    safeSet(setStatus, 'idle');
    safeSet(setError, null);
  }, [safeSet]);

  const forgetDeviceById = useCallback(
    async (id: string): Promise<{ forgotten: boolean; supported: boolean }> => {
      if (!navigator.usb) return { forgotten: false, supported: false };
      const list = rawDevicesRef.current;
      const target = list.find((d) => deviceId(d) === id);
      if (!target) return { forgotten: false, supported: false };
      // Se for o device ativo, libera o handle primeiro.
      if (activeHandle?.device === target) {
        await releaseHandle(activeHandle);
        activeHandle = null;
      }
      const supported = typeof target.forget === 'function';
      let forgotten = false;
      if (supported && target.forget) {
        try {
          await target.forget();
          forgotten = true;
        } catch {
          /* noop */
        }
      }
      // Se era a selecionada, limpa preferência.
      if (selectedId === id) {
        setSelectedId(null);
        writeSavedSelectedId(null);
      }
      await refresh();
      return { forgotten, supported };
    },
    [selectedId, refresh],
  );

  const forgetAllDevices = useCallback(async (): Promise<{
    forgotten: number;
    supported: boolean;
  }> => {
    if (!navigator.usb) return { forgotten: 0, supported: false };
    await releaseHandle(activeHandle);
    activeHandle = null;
    const list = await navigator.usb.getDevices();
    let forgotten = 0;
    let nativeSupported = false;
    for (const d of list) {
      if (typeof d.forget === 'function') {
        nativeSupported = true;
        try {
          await d.forget();
          forgotten += 1;
        } catch {
          /* noop */
        }
      }
    }
    setSelectedId(null);
    writeSavedSelectedId(null);
    await refresh();
    return { forgotten, supported: nativeSupported };
  }, [refresh]);

  const switchDevice = useCallback(async () => {
    await forgetAllDevices();
    await connect();
  }, [forgetAllDevices, connect]);

  const selectDevice = useCallback(
    (id: string | null) => {
      // Libera o handle atual pra forçar reabertura com o novo device no próximo print.
      void releaseHandle(activeHandle).then(() => {
        activeHandle = null;
      });
      setSelectedId(id);
      writeSavedSelectedId(id);
      safeSet(setStatus, 'idle');
      safeSet(setError, null);
    },
    [safeSet],
  );

  const printRaw = useCallback(
    async (zpl: string) => {
      safeSet(setError, null);
      safeSet(setStatus, 'printing');
      try {
        const handle = await ensureHandle();
        const data = new TextEncoder().encode(zpl);
        const res = await handle.device.transferOut(handle.endpointOut, data);
        if (res.status !== 'ok') {
          throw new Error(`Falha no transferOut (status: ${res.status})`);
        }
        safeSet(setStatus, 'connected');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Qualquer erro que indique handle inválido/perdido — limpa pra próximo print reabrir.
        // "Access denied" entra aqui: significa que o sistema (driver) reivindicou o device,
        // então não adianta reusar o handle atual.
        if (
          /(disconnected|transfer.*failed|stall|NotFoundError|InvalidStateError|access denied|in use|busy)/i.test(
            msg,
          )
        ) {
          await releaseHandle(activeHandle);
          activeHandle = null;
        }
        safeSet(setError, msg);
        safeSet(setStatus, 'error');
        throw err;
      }
    },
    [ensureHandle, safeSet],
  );

  const print = useCallback(
    async (label: ZebraLabelInput) => {
      const zpl = buildZpl(label);
      await printRaw(zpl);
    },
    [printRaw],
  );

  const selectedDevice = selectedId
    ? devices.find((d) => d.id === selectedId) ?? null
    : null;

  return {
    supported,
    devices,
    selectedId,
    selectedDevice,
    paired: devices.length > 0,
    status,
    error,
    connect,
    disconnect,
    forgetDeviceById,
    forgetAllDevices,
    switchDevice,
    selectDevice,
    print,
    printRaw,
    refresh,
  };
}
