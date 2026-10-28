/**
 * Energia do áudio em janelas de 10 ms, a base de toda decisão de corte. No produto, as amostras
 * vêm de `ffmpeg -i video -ac 1 -ar 16000 -f s16le -` lidas da saída padrão.
 */
import type { Energia } from "./tipos";

const JANELAS_POR_SEGUNDO = 100;

/** Piso somado ao RMS para o silêncio digital (zero) não virar menos infinito. */
const PISO_RMS = 1e-9;

/**
 * Calcula a energia a partir de amostras PCM de 16 bits com um canal.
 * Cada janela tem `taxa / 100` amostras; a sobra do final (menos de uma janela) é descartada,
 * mas a duração devolvida é a real (`amostras / taxa`).
 */
export function calcularEnergia(amostras: Int16Array, taxa: number): Energia {
  if (!Number.isInteger(taxa) || taxa < JANELAS_POR_SEGUNDO) {
    throw new RangeError(`taxa de amostragem invalida: ${taxa}`);
  }
  const passo = Math.floor(taxa / JANELAS_POR_SEGUNDO);
  const janelas = Math.floor(amostras.length / passo);
  const db = new Float32Array(janelas);
  for (let j = 0; j < janelas; j++) {
    let soma = 0;
    const inicio = j * passo;
    for (let k = 0; k < passo; k++) {
      const x = amostras[inicio + k] / 32768;
      soma += x * x;
    }
    const rms = Math.sqrt(soma / passo) + PISO_RMS;
    db[j] = 20 * Math.log10(rms);
  }
  return { db, duracao: amostras.length / taxa };
}

/** Atalho para o que o ffmpeg entrega: bytes de PCM s16le (little endian), mono. */
export function calcularEnergiaDeS16le(bytes: Uint8Array, taxa: number): Energia {
  const pares = Math.floor(bytes.length / 2);
  const amostras = new Int16Array(pares);
  for (let i = 0; i < pares; i++) {
    const valor = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    amostras[i] = valor >= 0x8000 ? valor - 0x10000 : valor;
  }
  return calcularEnergia(amostras, taxa);
}
