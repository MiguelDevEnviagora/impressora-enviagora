#!/usr/bin/env node
/* Gera os icones da extensao a partir da marca EnviAgora.
 *
 * POR QUE UM GERADOR, E NAO UM PNG SOLTO NO REPOSITORIO
 * O icone precisa existir em 4 tamanhos e o Chrome nao aceita SVG. Guardar 4 PNGs
 * binarios significa que ninguem mais consegue ajustar a marca sem reabrir um editor —
 * e que a proxima mudanca de paleta deixa os arquivos em silencio desatualizados. Aqui
 * a fonte da verdade e a geometria + os HEX oficiais, e os PNGs sao saida reproduzivel.
 *
 * A MARCA
 * Simbolo EnviAgora: a seta ↗, que e a reducao maxima do logo (a letra "a" do lettering).
 * Regra do manual para fundo escuro: fundo Verde Profundo #16302A + seta Verde Neon
 * #C5FF56. Cantos bem arredondados, como o resto do sistema visual de 2026.
 *
 * Sem dependencia: rasteriza por distancia de segmento (a seta e a uniao de 3 capsulas,
 * que e exatamente o que "stroke-linecap/linejoin: round" desenha) e escreve o PNG na
 * mao — cabecalho, IDAT com deflate do zlib do Node, e CRC32.
 *
 *   node scripts/gerar-icones.mjs
 */
import zlib from 'node:zlib';
import { fs, path, SRC, cor } from './lib/comum.mjs';

// ── Paleta oficial 2026 ─────────────────────────────────────────────────────
const VERDE_PROFUNDO = [0x16, 0x30, 0x2A];   // #16302A — fundo
const VERDE_NEON = [0xC5, 0xFF, 0x56];       // #C5FF56 — a seta

// ── Geometria do simbolo, no viewBox 100x100 do asset oficial ───────────────
// <path d="M28 72 L72 28"/>  e  <path d="M44 28 L72 28 L72 56"/>, stroke-width 15,
// linecap e linejoin "round". Tres segmentos com raio 7.5 cobrem exatamente isso: a
// uniao de capsulas ja produz as pontas e o canto arredondados, sem caso especial.
const RAIO_TRACO = 7.5;
const SEGMENTOS = [
  [28, 72, 72, 28],   // a diagonal
  [44, 28, 72, 28],   // aba de cima da ponta
  [72, 28, 72, 56]    // aba da direita da ponta
];

const TAMANHOS = [16, 32, 48, 128];
const AMOSTRAS = 4;                  // 4x4 por pixel — suficiente para nao serrilhar
const OCUPACAO = 0.56;               // quanto da largura do icone a seta ocupa
const RAIO_CANTO = 0.22;             // canto arredondado, proporcional ao lado

/** Distancia de um ponto ao segmento AB (a capsula e distancia <= raio). */
function distSegmento(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const c2 = vx * vx + vy * vy;
  let t = c2 === 0 ? 0 : (wx * vx + wy * vy) / c2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distancia com sinal a um quadrado de cantos arredondados centrado na origem. */
function distQuadradoArredondado(px, py, meio, raio) {
  const qx = Math.abs(px) - (meio - raio);
  const qy = Math.abs(py) - (meio - raio);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - raio;
}

function desenhar(S) {
  // Mapeia o viewBox para o icone. A seta ocupada vai de 20.5 a 79.5 (28..72 mais o raio
  // do traco dos dois lados), entao e ESSA extensao que precisa respeitar a OCUPACAO —
  // usar 0..100 deixaria o desenho pequeno demais dentro do quadrado.
  const extensao = (72 - 28) + 2 * RAIO_TRACO;
  const k = (OCUPACAO * S) / extensao;
  const meio = S / 2;
  const raioCanto = S * RAIO_CANTO;

  const px = Buffer.alloc(S * S * 4);
  const passo = 1 / AMOSTRAS;
  const inicio = passo / 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let coberturaFundo = 0;
      let coberturaSeta = 0;

      for (let sy = 0; sy < AMOSTRAS; sy++) {
        for (let sx = 0; sx < AMOSTRAS; sx++) {
          const ax = x + inicio + sx * passo;
          const ay = y + inicio + sy * passo;

          if (distQuadradoArredondado(ax - meio, ay - meio, meio, raioCanto) <= 0) {
            coberturaFundo++;
          }
          // volta para as coordenadas do viewBox
          const vx = (ax - meio) / k + 50;
          const vy = (ay - meio) / k + 50;
          for (const [x1, y1, x2, y2] of SEGMENTOS) {
            if (distSegmento(vx, vy, x1, y1, x2, y2) <= RAIO_TRACO) { coberturaSeta++; break; }
          }
        }
      }

      const total = AMOSTRAS * AMOSTRAS;
      const aFundo = coberturaFundo / total;
      // A seta so aparece dentro do fundo: sem isso ela vazaria pelos cantos arredondados.
      const aSeta = Math.min(coberturaSeta / total, aFundo);

      const i = (y * S + x) * 4;
      const alfa = aFundo;
      if (alfa === 0) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }

      // Compoe a seta sobre o fundo, ambos ja com cobertura propria.
      const mistura = aSeta / alfa;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(VERDE_PROFUNDO[c] * (1 - mistura) + VERDE_NEON[c] * mistura);
      }
      px[i + 3] = Math.round(alfa * 255);
    }
  }
  return px;
}

// ── PNG ─────────────────────────────────────────────────────────────────────
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tam, corpo, crc]);
}

function png(S, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;    // 8 bits por canal
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0;   // compressao deflate
  ihdr[11] = 0;   // filtro padrao
  ihdr[12] = 0;   // sem entrelacamento

  // Cada linha leva um byte de filtro na frente; 0 = sem filtro.
  const linhas = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    linhas[y * (S * 4 + 1)] = 0;
    pixels.copy(linhas, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    bloco('IEND', Buffer.alloc(0))
  ]);
}

// ── Escreve ─────────────────────────────────────────────────────────────────
const destino = path.join(SRC, 'icones');
fs.mkdirSync(destino, { recursive: true });

console.log('\n  Icones EnviAgora — seta neon sobre verde profundo\n');
for (const S of TAMANHOS) {
  const arquivo = path.join(destino, 'icone-' + S + '.png');
  const dados = png(S, desenhar(S));
  fs.writeFileSync(arquivo, dados);
  console.log('  ' + cor.ok(('icone-' + S + '.png').padEnd(20)) + dados.length + ' bytes');
}
console.log('\n  fundo  #16302A  Verde Profundo');
console.log('  seta   #C5FF56  Verde Neon\n');
