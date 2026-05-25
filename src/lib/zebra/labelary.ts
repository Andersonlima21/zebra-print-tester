'use client';

// Util de preview ZPL via Labelary (https://labelary.com).
//
// Free tier: 5 req/s por IP, sem auth, sem CORS lock (envia direto do browser).
// Endpoint: POST http://api.labelary.com/v1/printers/{dpmm}/labels/{width}x{height}/{index}/
//   - dpmm:  '8dpmm' (= 203 dpi, padrão Zebra GK420/ZD420)
//   - size:  '4x6'   (polegadas — bate com o builder em zpl.ts)
//   - index: 0       (primeiro label do ZPL — Labelary pagina cada ^XA/^XZ)
//
// Response: image/png (default), application/pdf, image/jpeg, image/gif via Accept header.

const LABELARY_BASE = 'http://api.labelary.com/v1/printers';

export interface LabelaryRenderOptions {
  /** Densidade em dots/mm. '8dpmm' = 203 dpi (default). Outras: 6dpmm (152dpi), 12dpmm (300dpi), 24dpmm (600dpi). */
  dpmm?: '6dpmm' | '8dpmm' | '12dpmm' | '24dpmm';
  /** Tamanho em polegadas (matches zpl.ts default 4x6). */
  widthIn?: number;
  heightIn?: number;
  /** Índice da página (0-based) se o ZPL tiver múltiplos labels. */
  index?: number;
  /** Formato de saída. */
  format?: 'png' | 'pdf' | 'jpg';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Envia ZPL ao Labelary e devolve uma Object URL pronta pra usar em <img src>.
 * Caller é responsável por chamar URL.revokeObjectURL(url) ao desmontar.
 *
 * Faz retry com backoff exponencial em 429 (rate limit) e 503 (server overloaded):
 * 250ms → 800ms → 2200ms. Total worst case ~3.3s pra 3 tentativas.
 */
export async function renderZplPreview(
  zpl: string,
  opts: LabelaryRenderOptions = {},
): Promise<string> {
  const dpmm = opts.dpmm ?? '8dpmm';
  const w = opts.widthIn ?? 4;
  const h = opts.heightIn ?? 6;
  const idx = opts.index ?? 0;
  const format = opts.format ?? 'png';
  const mime = format === 'pdf' ? 'application/pdf' : format === 'jpg' ? 'image/jpeg' : 'image/png';

  const url = `${LABELARY_BASE}/${dpmm}/labels/${w}x${h}/${idx}/`;

  const backoffs = [0, 250, 800, 2200]; // 1ª imediata, depois 3 retries
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) await sleep(backoffs[attempt]);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: mime,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: zpl,
      });
      if (res.ok) {
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      }
      // 429 (rate limit) ou 503 (overloaded) → retry. Outros 4xx/5xx → erro definitivo.
      if (res.status === 429 || res.status === 503) {
        const text = await res.text().catch(() => '');
        lastErr = new Error(
          `Labelary ${res.status} (rate limit, tentativa ${attempt + 1}/${backoffs.length}): ${text}`,
        );
        continue;
      }
      const text = await res.text().catch(() => '');
      throw new Error(`Labelary respondeu ${res.status}: ${text || 'erro desconhecido'}`);
    } catch (err) {
      // Network errors (fetch reject) também são retentados.
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Se foi exception NÃO-relacionada a rate limit (TypeError de rede), tenta de novo
      // só se ainda houver attempts.
      if (attempt === backoffs.length - 1) break;
    }
  }
  throw lastErr ?? new Error('Labelary indisponível.');
}
