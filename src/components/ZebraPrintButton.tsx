'use client';

// Botão que envia uma etiqueta pra impressora Zebra via WebUSB.
//
// Modos:
//   - "auto" (default): tenta WebUSB; se indisponível (Firefox/Safari/HTTP), cai pro preview Labelary.
//   - "usb":   força WebUSB; se não suporta, mostra botão desabilitado com explicação.
//   - "preview": força preview Labelary (gera PNG da etiqueta), nunca imprime de verdade.
//
// Estados do botão (modo USB):
//   - Sem device pareado       → "Conectar Zebra" (abre diálogo do browser)
//   - Pareado                  → "Imprimir Zebra"
//   - Imprimindo               → spinner + "Imprimindo…"
//   - Erro                     → ícone vermelho + tooltip com mensagem
//
// Uso típico:
//   <ZebraPrintButton label={{ kind: 'hu', code: 'HU-123', customerName: 'ACME' }} />
//
// Notas:
//   - WebUSB exige secure context (HTTPS ou localhost). Em dev .test ative chrome://flags/#unsafely-treat-insecure-origin-as-secure.
//   - Preview Labelary é gratuito (5 req/s/IP) e não precisa de hardware — ótimo pra dev.

import {
  Cable,
  Close,
  ContentCopy,
  ErrorOutline,
  Preview as PreviewIcon,
  Print,
  SwapHoriz,
} from '@mui/icons-material';
import {
  Box,
  Button,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  type ButtonProps,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { renderZplPreview } from '@/lib/zebra/labelary';
import { useZebraPrinter } from '@/lib/zebra/useZebraPrinter';
import { buildZpl, type ZebraLabelInput } from '@/lib/zebra/zpl';
import { useToast } from '@/components/ToastProvider';

/**
 * Copia texto pra clipboard com fallback pra contextos não-seguros (HTTP).
 *
 * navigator.clipboard só existe em secure context (HTTPS/localhost) — em dev .test
 * fica undefined. Fallback usa um <textarea> existente (precisa ser passado pra evitar
 * problema de focus trap em modais MUI — textarea criado e appended no body é
 * imediatamente roubado pelo focus trap do Dialog).
 */
async function copyTextSafe(
  text: string,
  fallbackTextarea?: HTMLTextAreaElement | null,
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied / focus etc. — cai pro fallback
    }
  }
  // Fallback execCommand — precisa do textarea estar montado dentro do Dialog
  // pra não ser roubado pelo focus trap do MUI.
  if (fallbackTextarea) {
    try {
      fallbackTextarea.value = text;
      fallbackTextarea.focus();
      fallbackTextarea.select();
      fallbackTextarea.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

export type ZebraPrintMode = 'auto' | 'usb' | 'preview';

export interface ZebraPrintButtonProps
  extends Omit<ButtonProps, 'onClick' | 'children' | 'onError'> {
  /** Etiqueta a imprimir. Pode ser uma única ou array (lote). */
  label: ZebraLabelInput | ZebraLabelInput[];
  /** Texto do botão quando pronto pra imprimir (default "Imprimir Zebra"). */
  children?: ReactNode;
  /** Mostra toast com sucesso/erro (default true). */
  showToast?: boolean;
  /**
   * Modo de operação:
   *   - 'auto' (default): tenta WebUSB; cai pro preview Labelary se indisponível.
   *   - 'usb': força WebUSB (botão desabilita se não suportar).
   *   - 'preview': sempre abre preview Labelary (não imprime de verdade).
   */
  mode?: ZebraPrintMode;
  /** Callback após sucesso. */
  onPrinted?: () => void;
  /** Callback em caso de erro (recebe a mensagem). */
  onPrintError?: (message: string) => void;
}

export function ZebraPrintButton({
  label,
  children,
  showToast = true,
  mode = 'auto',
  onPrinted,
  onPrintError,
  ...buttonProps
}: ZebraPrintButtonProps) {
  const toast = useToast();
  const { supported, paired, selectedDevice, status, error, connect, switchDevice, print } =
    useZebraPrinter();
  const deviceLabel = selectedDevice?.label ?? null;
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Estado do modal de preview Labelary.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [zplVisible, setZplVisible] = useState(false);
  const zplTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Libera object URLs ao fechar o modal pra evitar leak.
  useEffect(() => {
    if (!previewOpen && previewUrls.length > 0) {
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
      setPreviewUrls([]);
      setZplVisible(false);
    }
  }, [previewOpen, previewUrls]);

  // Resolve modo efetivo: 'preview' explicit, 'usb' explicit, ou 'auto' decide pelo suporte.
  const effectiveMode: 'usb' | 'preview' = (() => {
    if (mode === 'preview') return 'preview';
    if (mode === 'usb') return 'usb';
    return supported ? 'usb' : 'preview';
  })();

  const labels = Array.isArray(label) ? label : [label];

  const runPreview = useCallback(async () => {
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      // Sequencial com pequena pausa entre etiquetas — Labelary tem rate limit 5 req/s/IP
      // e IP corporativo compartilhado bate fácil. O próprio renderZplPreview já faz retry
      // com backoff em 429, mas espaçar reduz a chance de cair em retry.
      const urls: string[] = [];
      for (let i = 0; i < labels.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 250));
        // eslint-disable-next-line no-await-in-loop
        const url = await renderZplPreview(buildZpl(labels[i]));
        urls.push(url);
        // Vai populando o array on-the-fly pra usuário ver as etiquetas saindo.
        setPreviewUrls([...urls]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewError(msg);
      if (showToast) toast.error(`Falha no preview: ${msg}`);
      onPrintError?.(msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [labels, showToast, toast, onPrintError]);

  const runUsbPrint = useCallback(async () => {
    setBusy(true);
    try {
      if (!paired) {
        await connect();
        return; // pareou — usuário clica de novo pra imprimir
      }
      for (const l of labels) {
        // Sequencial — concorrente trava o endpoint USB.
        // eslint-disable-next-line no-await-in-loop
        await print(l);
      }
      if (showToast) toast.success('Etiqueta enviada à impressora.');
      onPrinted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (showToast) toast.error(`Erro ao imprimir: ${msg}`);
      onPrintError?.(msg);
    } finally {
      setBusy(false);
    }
  }, [paired, connect, labels, print, showToast, toast, onPrinted, onPrintError]);

  const handleClick = useCallback(() => {
    if (effectiveMode === 'preview') {
      void runPreview();
    } else {
      void runUsbPrint();
    }
  }, [effectiveMode, runPreview, runUsbPrint]);

  const handleSwitch = useCallback(async () => {
    setSwitching(true);
    try {
      await switchDevice();
      if (showToast) toast.success('Pareamento trocado — selecione a nova impressora.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (showToast) toast.error(`Falha ao trocar: ${msg}`);
    } finally {
      setSwitching(false);
    }
  }, [switchDevice, showToast, toast]);

  // ── Render por estado ──

  const printing = busy || status === 'printing' || status === 'connecting';
  const hasError = effectiveMode === 'usb' && status === 'error' && !!error;
  const isPreviewMode = effectiveMode === 'preview';

  let icon: ReactNode;
  let labelText: ReactNode;
  let color: ButtonProps['color'] = buttonProps.color ?? 'primary';
  let tooltip: string;

  if (isPreviewMode) {
    icon = previewLoading ? <CircularProgress size={16} color="inherit" /> : <PreviewIcon />;
    labelText =
      mode === 'preview'
        ? (children ?? 'Visualizar etiqueta')
        : 'Visualizar (sem USB)';
    tooltip =
      mode === 'preview'
        ? 'Renderiza a etiqueta via Labelary.com (não imprime)'
        : 'WebUSB indisponível. Visualizando via Labelary.';
  } else if (printing) {
    icon = <CircularProgress size={16} color="inherit" />;
    labelText = status === 'connecting' ? 'Conectando…' : 'Imprimindo…';
    tooltip = '';
  } else if (!paired) {
    icon = <Cable />;
    labelText = 'Conectar Zebra';
    tooltip = 'Conectar impressora Zebra USB';
  } else if (hasError) {
    icon = <ErrorOutline />;
    labelText = children ?? 'Imprimir Zebra';
    color = 'error';
    tooltip = `Erro: ${error}. Clique pra tentar de novo.`;
  } else {
    icon = <Print />;
    labelText = children ?? 'Imprimir Zebra';
    tooltip = deviceLabel ? `Impressora: ${deviceLabel}` : 'Imprimir em impressora Zebra';
  }

  const showSwitchBtn = effectiveMode === 'usb' && paired;

  return (
    <>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ display: 'inline-flex' }}>
        <Tooltip title={tooltip}>
          <span>
            <Button
              {...buttonProps}
              onClick={handleClick}
              disabled={printing || previewLoading || switching || buttonProps.disabled}
              startIcon={icon}
              color={color}
              sx={{ textTransform: 'none', ...buttonProps.sx }}
            >
              {labelText}
            </Button>
          </span>
        </Tooltip>
        {showSwitchBtn && (
          <Tooltip title="Trocar impressora (esquece a atual e abre o diálogo pra parear outra)">
            <span>
              <IconButton
                size="small"
                onClick={handleSwitch}
                disabled={switching || printing}
                aria-label="Trocar impressora Zebra"
              >
                {switching ? <CircularProgress size={16} /> : <SwapHoriz fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>

      {/* Modal de preview Labelary */}
      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <PreviewIcon color="primary" />
            <span>Preview da etiqueta {labels.length > 1 ? `(${labels.length} páginas)` : ''}</span>
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={() => setPreviewOpen(false)}>
              <Close />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {/* Loading inline no topo, mas mostra imagens já carregadas abaixo. */}
          {previewLoading && (
            <Stack
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{ py: 1.5, mb: previewUrls.length > 0 ? 2 : 0 }}
            >
              <CircularProgress size={18} />
              <Typography variant="caption" color="text.secondary">
                Renderizando via Labelary
                {labels.length > 1 ? ` (${previewUrls.length + 1} de ${labels.length})…` : '…'}
              </Typography>
            </Stack>
          )}
          {previewError && (
            <Stack alignItems="center" sx={{ py: 4 }} spacing={1.5}>
              <ErrorOutline color="error" sx={{ fontSize: 40 }} />
              <Typography variant="body2" color="error" sx={{ textAlign: 'center' }}>
                {previewError}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 480 }}>
                Labelary tem rate limit de 5 req/s/IP. Em rede corporativa o IP é compartilhado e
                bate fácil. Aguarde alguns segundos e tente de novo, ou copie o ZPL e cole em
                labelary.com manualmente.
              </Typography>
            </Stack>
          )}
          {previewUrls.length > 0 && (
            <Stack spacing={3} alignItems="center">
              {previewUrls.map((url, i) => (
                <Box key={url} sx={{ textAlign: 'center' }}>
                  {labels.length > 1 && (
                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                      Página {i + 1} de {labels.length}
                    </Typography>
                  )}
                  <Box
                    component="img"
                    src={url}
                    alt={`Preview etiqueta ${i + 1}`}
                    sx={{
                      maxWidth: '100%',
                      maxHeight: '70vh',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      bgcolor: '#fff',
                    }}
                  />
                </Box>
              ))}
            </Stack>
          )}
          {/* Textarea visível com o ZPL — usuário pode Ctrl+A / Ctrl+C manualmente.
              Fica colapsado por default. */}
          <Collapse in={zplVisible} unmountOnExit>
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                ZPL gerado — clique pra selecionar tudo e copie com Ctrl+C
              </Typography>
              <Box
                component="textarea"
                ref={zplTextareaRef}
                readOnly
                onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => {
                  e.currentTarget.focus();
                  e.currentTarget.select();
                }}
                value={labels.map(buildZpl).join('\n')}
                sx={{
                  width: '100%',
                  minHeight: 180,
                  maxHeight: 320,
                  p: 1,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  resize: 'vertical',
                  bgcolor: 'background.default',
                }}
              />
            </Box>
          </Collapse>
        </DialogContent>
        <DialogActions>
          <Button
            size="small"
            startIcon={<ContentCopy />}
            onClick={async () => {
              const zpl = labels.map(buildZpl).join('\n');
              // Sempre mostra o textarea antes — garante que tenha fallback visível
              // mesmo se o programmatic copy parecer ter funcionado mas não copiou.
              setZplVisible(true);
              const ok = await copyTextSafe(zpl, zplTextareaRef.current);
              if (showToast) {
                if (ok) {
                  toast.success('ZPL copiado — se Ctrl+V não funcionar, use o textarea abaixo.');
                } else {
                  toast.error('Auto-cópia falhou — selecione o ZPL abaixo e copie manualmente.');
                }
              }
            }}
            sx={{ textTransform: 'none' }}
          >
            Copiar ZPL
          </Button>
          <Button
            size="small"
            onClick={() => setZplVisible((v) => !v)}
            sx={{ textTransform: 'none' }}
          >
            {zplVisible ? 'Ocultar ZPL' : 'Mostrar ZPL'}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setPreviewOpen(false)} sx={{ textTransform: 'none' }}>
            Fechar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
