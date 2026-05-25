// Builder ZPL (Zebra Programming Language) — etiquetas 4x6 pol @ 203 dpi (812×1218 dots).
// Sem deps React; funções puras retornam string ZPL pronta pra mandar via WebUSB.
//
// Referência: Zebra ZPL Programming Guide
//   ^XA / ^XZ          — início/fim do label
//   ^PWnnn / ^LLnnn    — print width + label length em dots
//   ^FOx,y             — field origin (canto sup. esquerdo do campo)
//   ^A0N,h,w           — fonte 0 (scalable), N=normal orientation, h=altura, w=largura
//   ^FD ... ^FS        — field data + field separator (fim do campo)
//   ^BCN,h,Y,N,N       — Code128 barcode (N orient, h dots, exibe valor, não checkdigit)
//   ^BQN,2,7           — QR Code (N orient, modelo 2, magnification 7)
//   ^GB w,h,t          — graphic box (linha, w/h/thickness em dots)

// ════════════════════════════════════════════════════════════
// CONSTANTES — etiqueta 4x6 pol @ 203 dpi (Zebra padrão)
// ════════════════════════════════════════════════════════════

/** 203 dots por polegada (densidade Zebra padrão GK420d/ZD420). */
const DPI = 203;
const PRINT_WIDTH_DOTS = 4 * DPI; // 812
const LABEL_LENGTH_DOTS = 6 * DPI; // 1218
const MARGIN_DOTS = 24; // ~3mm de margem segura

// ════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════

export interface ZebraLabelField {
  /** Rótulo curto exibido em fonte pequena (ex: "Cliente"). */
  label: string;
  /** Valor — exibido em fonte maior abaixo do rótulo. */
  value: string;
}

export interface ZebraGenericLabel {
  kind: 'generic';
  /** Texto principal no topo (ex: código). */
  title: string;
  /** Subtítulo opcional (ex: nome do cliente). */
  subtitle?: string;
  /** Valor codificado no barcode CODE128 (default: title). */
  barcodeValue?: string;
  /** Lista de campos em grid 2-col abaixo do barcode. */
  fields?: ZebraLabelField[];
  /** Linha pequena no rodapé (timestamp, operador, etc). */
  footer?: string;
  /** Quantidade de cópias (default 1). */
  copies?: number;
}

export interface ZebraHuLabel {
  kind: 'hu';
  code: string; // HU-NNNNNN
  customerName: string;
  carrierName?: string | null;
  typeName?: string;
  volumesCount?: number;
  warehouseName?: string;
  copies?: number;
}

export interface ZebraVolumeLabel {
  kind: 'volume';
  code: string; // VOL-NNNNNN
  separationOrderCode: string;
  customerName: string;
  productName?: string;
  weightKg?: number | string | null;
  copies?: number;
}

export interface ZebraLoadLabel {
  kind: 'load';
  code: string; // ROM-NNNNNN
  customerName: string;
  carrierName?: string | null;
  driverName?: string | null;
  vehiclePlate?: string | null;
  copies?: number;
}

export type ZebraLabelInput =
  | ZebraGenericLabel
  | ZebraHuLabel
  | ZebraVolumeLabel
  | ZebraLoadLabel;

// ════════════════════════════════════════════════════════════
// HELPERS — sanitização ZPL
// ════════════════════════════════════════════════════════════

/**
 * ZPL usa `^` e `~` como delimitadores de comando. Caracteres acima de 0x7F precisam
 * de codificação UTF-8 (Zebra moderna aceita ^CI28 que ativa UTF-8). Aqui apenas escapamos
 * os delimitadores; o ^CI28 vai no header.
 */
function zplEscape(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/[\^~\\]/g, '');
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ════════════════════════════════════════════════════════════
// BUILDER GENÉRICO (todos os tipos passam por aqui)
// ════════════════════════════════════════════════════════════

function buildGenericZpl(label: ZebraGenericLabel): string {
  const title = truncate(zplEscape(label.title), 30);
  const subtitle = label.subtitle ? truncate(zplEscape(label.subtitle), 40) : '';
  const barcodeValue = zplEscape(label.barcodeValue ?? label.title);
  const fields = (label.fields ?? []).slice(0, 8); // max 8 fields no grid
  const footer = label.footer ? truncate(zplEscape(label.footer), 60) : '';

  const lines: string[] = [];
  lines.push('^XA'); // start
  lines.push('^CI28'); // habilita UTF-8 (chars acentuados)
  lines.push(`^PW${PRINT_WIDTH_DOTS}`);
  lines.push(`^LL${LABEL_LENGTH_DOTS}`);
  lines.push('^LH0,0');

  // ── Header — Title ──
  lines.push(`^FO${MARGIN_DOTS},${MARGIN_DOTS}`);
  lines.push('^A0N,80,80'); // fonte escalável 80×80 dots
  lines.push(`^FD${title}^FS`);

  // ── Subtitle ──
  let cursorY = MARGIN_DOTS + 90;
  if (subtitle) {
    lines.push(`^FO${MARGIN_DOTS},${cursorY}`);
    lines.push('^A0N,38,38');
    lines.push(`^FD${subtitle}^FS`);
    cursorY += 50;
  }

  // ── Divisor ──
  lines.push(`^FO${MARGIN_DOTS},${cursorY + 10}`);
  lines.push(`^GB${PRINT_WIDTH_DOTS - 2 * MARGIN_DOTS},3,3^FS`);
  cursorY += 30;

  // ── Barcode CODE128 ──
  lines.push(`^FO${MARGIN_DOTS},${cursorY}`);
  lines.push('^BY3,3,140'); // module width 3, ratio 3, height 140
  lines.push('^BCN,140,Y,N,N');
  lines.push(`^FD${barcodeValue}^FS`);
  cursorY += 190;

  // ── Grid de campos (2 colunas) ──
  if (fields.length > 0) {
    lines.push(`^FO${MARGIN_DOTS},${cursorY}`);
    lines.push(`^GB${PRINT_WIDTH_DOTS - 2 * MARGIN_DOTS},3,3^FS`);
    cursorY += 20;
    const colWidth = (PRINT_WIDTH_DOTS - 2 * MARGIN_DOTS) / 2;
    const rowHeight = 105;
    fields.forEach((f, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = MARGIN_DOTS + col * colWidth;
      const y = cursorY + row * rowHeight;
      // label
      lines.push(`^FO${x},${y}`);
      lines.push('^A0N,26,26');
      lines.push(`^FD${truncate(zplEscape(f.label), 22).toUpperCase()}^FS`);
      // value
      lines.push(`^FO${x},${y + 32}`);
      lines.push('^A0N,42,42');
      lines.push(`^FD${truncate(zplEscape(f.value || '—'), 24)}^FS`);
    });
    const rowsUsed = Math.ceil(fields.length / 2);
    cursorY += rowsUsed * rowHeight + 10;
  }

  // ── Rodapé ──
  if (footer) {
    const footerY = LABEL_LENGTH_DOTS - MARGIN_DOTS - 30;
    lines.push(`^FO${MARGIN_DOTS},${footerY - 10}`);
    lines.push(`^GB${PRINT_WIDTH_DOTS - 2 * MARGIN_DOTS},2,2^FS`);
    lines.push(`^FO${MARGIN_DOTS},${footerY}`);
    lines.push('^A0N,24,24');
    lines.push(`^FD${footer}^FS`);
  }

  // ── Cópias ──
  if (label.copies && label.copies > 1) {
    lines.push(`^PQ${label.copies}`);
  }

  lines.push('^XZ'); // end
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
// ADAPTADORES — convertem cada label tipado em ZebraGenericLabel
// ════════════════════════════════════════════════════════════

function huToGeneric(l: ZebraHuLabel): ZebraGenericLabel {
  const fields: ZebraLabelField[] = [
    { label: 'Cliente', value: l.customerName },
    { label: 'Transportadora', value: l.carrierName ?? '—' },
  ];
  if (l.typeName) fields.push({ label: 'Tipo', value: l.typeName });
  if (typeof l.volumesCount === 'number')
    fields.push({ label: 'Volumes', value: String(l.volumesCount) });
  if (l.warehouseName) fields.push({ label: 'Armazém', value: l.warehouseName });
  return {
    kind: 'generic',
    title: l.code,
    subtitle: 'Unitizador',
    barcodeValue: l.code,
    fields,
    footer: `Impresso ${new Date().toLocaleString('pt-BR')}`,
    copies: l.copies,
  };
}

function volumeToGeneric(l: ZebraVolumeLabel): ZebraGenericLabel {
  const fields: ZebraLabelField[] = [
    { label: 'OS', value: l.separationOrderCode },
    { label: 'Cliente', value: l.customerName },
  ];
  if (l.productName) fields.push({ label: 'Produto', value: l.productName });
  if (l.weightKg != null && l.weightKg !== '') {
    const w = typeof l.weightKg === 'number' ? l.weightKg.toFixed(3) : String(l.weightKg);
    fields.push({ label: 'Peso (kg)', value: w });
  }
  return {
    kind: 'generic',
    title: l.code,
    subtitle: 'Volume',
    barcodeValue: l.code,
    fields,
    footer: `Impresso ${new Date().toLocaleString('pt-BR')}`,
    copies: l.copies,
  };
}

function loadToGeneric(l: ZebraLoadLabel): ZebraGenericLabel {
  const fields: ZebraLabelField[] = [
    { label: 'Cliente', value: l.customerName },
    { label: 'Transportadora', value: l.carrierName ?? '—' },
  ];
  if (l.driverName) fields.push({ label: 'Motorista', value: l.driverName });
  if (l.vehiclePlate) fields.push({ label: 'Placa', value: l.vehiclePlate.toUpperCase() });
  return {
    kind: 'generic',
    title: l.code,
    subtitle: 'Romaneio',
    barcodeValue: l.code,
    fields,
    footer: `Impresso ${new Date().toLocaleString('pt-BR')}`,
    copies: l.copies,
  };
}

// ════════════════════════════════════════════════════════════
// API PÚBLICA
// ════════════════════════════════════════════════════════════

/**
 * Constrói a string ZPL pra qualquer um dos 4 tipos suportados.
 * Output deve ser encodado UTF-8 (TextEncoder) antes do transferOut.
 */
export function buildZpl(input: ZebraLabelInput): string {
  switch (input.kind) {
    case 'generic':
      return buildGenericZpl(input);
    case 'hu':
      return buildGenericZpl(huToGeneric(input));
    case 'volume':
      return buildGenericZpl(volumeToGeneric(input));
    case 'load':
      return buildGenericZpl(loadToGeneric(input));
  }
}

/** Concatena ZPLs (impressão em lote — Zebra processa um após o outro). */
export function buildZplBatch(labels: ZebraLabelInput[]): string {
  return labels.map(buildZpl).join('\n');
}
