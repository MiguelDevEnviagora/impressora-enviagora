/* Escritor de ZIP minimo, sem dependencia nenhuma.
 *
 * POR QUE ESCREVER UM EM VEZ DE INSTALAR UM PACOTE
 * Este ZIP e assinado e vira o CRX que atualiza ~60 maquinas. Cadeia de dependencia
 * curta aqui vale mais do que conveniencia: menos codigo de terceiro no caminho entre o
 * fonte e a chave privada. Sao ~90 linhas de formato publicado e estavel desde 1989.
 *
 * O ZIP gerado e DETERMINISTICO: mesma entrada, bytes identicos na saida. Data fixa em
 * 1980-01-01 (o zero do formato) e ordem de arquivos estavel. E o que permite conferir
 * que dois builds da mesma versao produziram o mesmo pacote.
 */
import zlib from 'node:zlib';

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

// 1980-01-01 00:00:00 em data/hora DOS — o menor valor que o formato representa.
const DATA_DOS = (0 << 9) | (1 << 5) | 1;   // ano-1980=0, mes=1, dia=1
const HORA_DOS = 0;

/**
 * @param {Array<{nome: string, dados: Buffer}>} entradas caminhos com barra normal
 * @returns {Buffer}
 */
export function criarZip(entradas) {
  // Ordem estavel: dois builds da mesma arvore produzem o mesmo ZIP.
  const itens = [...entradas].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));

  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const item of itens) {
    const nome = Buffer.from(item.nome, 'utf8');
    const cru = item.dados;
    const comprimido = zlib.deflateRawSync(cru, { level: 9 });

    // Se comprimir nao ajudou (ja e PNG, ja e minificado), guarda sem compressao.
    const usarDeflate = comprimido.length < cru.length;
    const corpo = usarDeflate ? comprimido : cru;
    const metodo = usarDeflate ? 8 : 0;
    const crc = crc32(cru);

    const cabecalhoLocal = Buffer.alloc(30);
    cabecalhoLocal.writeUInt32LE(0x04034b50, 0);   // assinatura
    cabecalhoLocal.writeUInt16LE(20, 4);           // versao necessaria
    cabecalhoLocal.writeUInt16LE(0x0800, 6);       // flags: nome em UTF-8
    cabecalhoLocal.writeUInt16LE(metodo, 8);
    cabecalhoLocal.writeUInt16LE(HORA_DOS, 10);
    cabecalhoLocal.writeUInt16LE(DATA_DOS, 12);
    cabecalhoLocal.writeUInt32LE(crc, 14);
    cabecalhoLocal.writeUInt32LE(corpo.length, 18);
    cabecalhoLocal.writeUInt32LE(cru.length, 22);
    cabecalhoLocal.writeUInt16LE(nome.length, 26);
    cabecalhoLocal.writeUInt16LE(0, 28);           // sem campo extra

    locais.push(cabecalhoLocal, nome, corpo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);                  // versao de quem criou
    central.writeUInt16LE(20, 6);                  // versao necessaria
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(HORA_DOS, 12);
    central.writeUInt16LE(DATA_DOS, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(corpo.length, 20);
    central.writeUInt32LE(cru.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt16LE(0, 30);                  // extra
    central.writeUInt16LE(0, 32);                  // comentario
    central.writeUInt16LE(0, 34);                  // disco inicial
    central.writeUInt16LE(0, 36);                  // atributos internos
    central.writeUInt32LE(0o644 << 16, 38);        // atributos externos (permissao unix)
    central.writeUInt32LE(deslocamento, 42);

    centrais.push(central, nome);
    deslocamento += cabecalhoLocal.length + nome.length + corpo.length;
  }

  const blocoCentral = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);                         // numero do disco
  fim.writeUInt16LE(0, 6);                         // disco do diretorio central
  fim.writeUInt16LE(itens.length, 8);
  fim.writeUInt16LE(itens.length, 10);
  fim.writeUInt32LE(blocoCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  fim.writeUInt16LE(0, 20);                        // sem comentario

  return Buffer.concat([...locais, blocoCentral, fim]);
}
