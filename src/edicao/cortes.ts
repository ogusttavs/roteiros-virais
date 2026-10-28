/**
 * Planejamento de cortes (E47, PR 1): das palavras com tempo e do mapa de energia do áudio
 * sai a lista de trechos que ficam (a `Edl`). Cálculo puro, sem arquivo, rede nem IA.
 *
 * As regras de ritmo vêm do editor do Gustavo (`reference/ritmo.md`, nascidas de reclamações reais:
 * "cortando antes de terminar a palavra", "o final ficou meio cortado"). Resumo:
 *   - corta pela fala; o volume só mede o tamanho real das pausas;
 *   - pausa maior que `pausaMaxima` e quase toda silêncio vira `pausaQueFica`;
 *   - remoções (retake, falso início) e seleções (versão curta) chegam prontas da decisão editorial;
 *   - o ponto de corte nunca pega uma palavra ainda soando, mesmo que o fim marcado pelo
 *     transcritor venha cedo: quem manda é o áudio;
 *   - o vídeo abre uns 0,1 s antes da voz subir, nunca em silêncio.
 */
import {
  ErroEdicao,
  type ConfigCorte,
  type Edl,
  type Energia,
  type IntervaloEditorial,
  type PalavraFalada,
  type PresetRitmo,
  type Ritmo,
  type TransicaoCorte,
  type Trecho,
} from "./tipos";

export const RITMOS: Record<PresetRitmo, Ritmo> = {
  vlog: { pausaMaxima: 1.0, pausaQueFica: 0.6, folgaInicio: 0.5, folgaFim: 0.6 },
  aula: { pausaMaxima: 0.5, pausaQueFica: 0.3, folgaInicio: 0.4, folgaFim: 0.6 },
  reels: { pausaMaxima: 0.6, pausaQueFica: 0.35, folgaInicio: 0.2, folgaFim: 0.5 },
};

/** Folga mínima depois do fim da última palavra antes de um corte. */
const FOLGA_DEPOIS = 0.25;
/** Folga antes da primeira palavra depois de um corte. */
const FOLGA_ANTES = 0.15;
/** O vídeo abre este tanto antes de a voz subir. */
const FOLGA_ABERTURA = 0.1;
/** Silêncio mais curto que isto nem entra na conta. */
const SILENCIO_MINIMO = 0.25;
/** Trecho mais curto que isto é descartado. */
const TRECHO_MINIMO = 0.3;
/** Segundos de último quadro parado quando a gravação não tem respiro natural. */
const RESPIRO_PADRAO = 1.2;
/** Respiro natural a partir do qual não precisa congelar quadro. */
const RESPIRO_NATURAL = 0.5;

type Corte = [number, number, string];

/** Python arredonda o que cai em .5 para o par; `toFixed` olha o valor exato do double, como ele. */
function arredondar(x: number, casas: number): number {
  return Number(x.toFixed(casas)) + 0;
}

function percentil(valores: Float32Array, p: number): number {
  const ordenados = Float32Array.from(valores).sort();
  const pos = (p / 100) * (ordenados.length - 1);
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo);
}

/** Intervalos (em segundos) em que a energia fica abaixo do limiar por pelo menos `SILENCIO_MINIMO`. */
function trechosSilenciosos(db: Float32Array, limiar: number): Array<[number, number]> {
  const corridas: Array<[number, number]> = [];
  let inicio: number | null = null;
  for (let i = 0; i < db.length; i++) {
    const quieto = db[i] < limiar;
    if (quieto && inicio === null) {
      inicio = i;
    } else if (!quieto && inicio !== null) {
      if ((i - inicio) / 100 >= SILENCIO_MINIMO) corridas.push([inicio / 100, i / 100]);
      inicio = null;
    }
  }
  if (inicio !== null && (db.length - inicio) / 100 >= SILENCIO_MINIMO) {
    corridas.push([inicio / 100, db.length / 100]);
  }
  return corridas;
}

/** Une cortes que se tocam (até 50 ms de vão), guardando os motivos de cada um. */
function unir(cortes: Corte[]): Corte[] {
  const ordenados = [...cortes].sort(
    (x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0),
  );
  const saida: Corte[] = [];
  for (const [a, b, porque] of ordenados) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && a <= ultimo[1] + 0.05) {
      saida[saida.length - 1] = [
        ultimo[0],
        Math.max(ultimo[1], b),
        ultimo[2] === porque ? ultimo[2] : `${ultimo[2]}+${porque}`,
      ];
    } else {
      saida.push([a, b, porque]);
    }
  }
  return saida;
}

function dentro(i: IntervaloEditorial, valor: number): boolean {
  return i.de <= valor && valor <= i.ate;
}

export type EntradaCortes = {
  palavras: PalavraFalada[];
  energia: Energia;
  config?: ConfigCorte;
};

export function planejarCortes(entrada: EntradaCortes): Edl {
  const { palavras, energia } = entrada;
  const config = entrada.config ?? {};
  const db = energia.db;
  const total = energia.duracao;
  if (db.length === 0) throw new ErroEdicao("audio sem energia: nada a cortar");
  if (palavras.length === 0) throw new ErroEdicao("nenhuma palavra transcrita");

  const ritmo: Ritmo = { ...RITMOS[config.preset ?? "vlog"], ...config.ritmo };
  const remocoes = config.remocoes ?? [];
  const selecoes = config.selecoes ?? [];
  const meio = (w: PalavraFalada) => (w.inicio + w.fim) / 2;

  // Limiar adaptativo: ruído de fundo (percentil 10) mais 9 dB, travado entre -45 e -30 dB.
  const limiar = Math.min(Math.max(percentil(db, 10) + 9, -45), -30);
  const silencios = trechosSilenciosos(db, limiar);
  // Nível suavizado (máximo em 60 ms): queda rápida no meio da palavra não conta como fim dela.
  const dbSuave = new Float32Array(db.length);
  for (let k = 0; k < db.length; k++) {
    let maximo = -Infinity;
    for (let m = Math.max(0, k - 3); m < Math.min(db.length, k + 3); m++)
      maximo = Math.max(maximo, db[m]);
    dbSuave[k] = maximo;
  }

  // 1) palavras removidas pela decisão editorial, e (versão curta) tudo que está fora das seleções
  const removidas = new Set<number>();
  for (const r of remocoes) {
    palavras.forEach((w, i) => {
      if (dentro(r, meio(w))) removidas.add(i);
    });
  }
  if (selecoes.length > 0) {
    palavras.forEach((w, i) => {
      if (!selecoes.some((s) => dentro(s, meio(w)))) removidas.add(i);
    });
  }
  const mantidas = palavras.map((_, i) => i).filter((i) => !removidas.has(i));
  if (mantidas.length === 0) throw new ErroEdicao("nenhuma palavra mantida");

  /**
   * A palavra "acabou" quando o som cai abaixo do limiar OU 15 dB abaixo do pico dela
   * (em ambiente barulhento o ruído fica acima do limiar e a fala nunca acabaria).
   */
  function pisoDeFala(fim: number): number {
    const de = Math.max(0, Math.trunc((fim - 0.3) * 100));
    const ate = Math.min(db.length, Math.trunc(fim * 100) + 1);
    let pico = -Infinity;
    for (let k = de; k < ate; k++) pico = Math.max(pico, db[k]);
    return Math.max(limiar, pico - 15);
  }

  /** Ponto de corte depois de uma palavra que termina em `fim`, sem invadir a próxima fala. */
  function fimSeguro(fim: number): number {
    // inclui palavra colada
    const proximas = palavras
      .filter((w) => w.inicio >= fim - 0.02 && w.fim > fim + 0.01)
      .map((w) => w.inicio);
    let i = Math.trunc(fim * 100);
    const parada = Math.trunc(Math.min(fim + 0.6, total) * 100);
    const piso = pisoDeFala(fim);
    while (i < parada && i < dbSuave.length && dbSuave[i] >= piso) i++; // palavra ainda soando
    let corte = Math.max(fim + FOLGA_DEPOIS, i / 100 + 0.12);
    const fimDoSom = i / 100;
    let limiteProxima: number;
    if (proximas.length > 0) {
      const n0 = Math.min(...proximas);
      if (n0 > fim + 0.15 && i >= parada) {
        // ruído de fundo alto (rua, loja) nunca "cai": não é fala, folga fixa até a próxima palavra
        limiteProxima = n0 - 0.04;
        corte = fim + 0.45;
      } else if (i >= parada || fimDoSom > n0 + 0.25) {
        // fala corrida de verdade (o som segue pela próxima palavra adentro):
        // corta no vale de energia entre as duas palavras (fim real da sílaba)
        const a0 = Math.trunc(Math.max(0, fim - 0.05) * 100);
        const b0 = Math.min(db.length, Math.trunc(Math.min(total, n0 + 0.12, fim + 0.6) * 100));
        if (b0 > a0) {
          let k = a0;
          for (let m = a0 + 1; m < b0; m++) if (db[m] < db[k]) k = m;
          return Math.max(k / 100 + 0.01, fim - 0.03);
        }
        limiteProxima = n0 - 0.04;
      } else {
        // o som parou: o transcritor costuma marcar o fim cedo e esticar o início da próxima.
        // Quem manda é o áudio: o limite é onde o som volta a subir (próxima fala de verdade).
        let j = i;
        const parada2 = Math.trunc(Math.min(fim + 1.2, total) * 100);
        while (j < parada2 && j < dbSuave.length && dbSuave[j] < piso) j++;
        limiteProxima = j < parada2 ? Math.max(j / 100 - 0.06, fimDoSom + 0.05) : total;
      }
    } else {
      limiteProxima = total;
    }
    const limite = Math.min(total, limiteProxima, total);
    // colada de verdade na próxima: ainda assim deixa 80 ms
    return Math.min(corte, Math.max(limite, fim + 0.08));
  }

  /** Ponto de entrada antes de uma palavra que começa em `inicio`, sem pegar o fim da anterior. */
  function inicioSeguro(inicio: number): number {
    const anteriores = palavras.filter((w) => w.inicio < inicio - 0.02).map((w) => w.fim);
    const limite = Math.max(anteriores.length > 0 ? Math.max(...anteriores) + 0.04 : 0, 0);
    return Math.max(inicio - FOLGA_ANTES, Math.min(limite, inicio - 0.05));
  }

  const cortes: Corte[] = [];
  const conjuntoMantidas = new Set(mantidas);

  // 1a) cada bloco seguido de palavras removidas vira um corte, encaixado nas vizinhas mantidas
  for (let i = 0; i < palavras.length;) {
    if (!removidas.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < palavras.length && removidas.has(j + 1)) j++;
    const anteriores = mantidas.filter((k) => k < i);
    const seguintes = mantidas.filter((k) => k > j);
    const a = anteriores.length > 0 ? fimSeguro(palavras[Math.max(...anteriores)].fim) : 0;
    const b = seguintes.length > 0 ? inicioSeguro(palavras[Math.min(...seguintes)].inicio) : total;
    if (b > a) cortes.push([a, b, "removido"]);
    i = j + 1;
  }

  // 1b) remoção sem palavra (caminhada, tempo morto): corta o intervalo, respeitando as falas vizinhas
  for (const r of remocoes) {
    if (palavras.some((w) => dentro(r, meio(w)))) continue;
    const a2 = Math.max(
      r.de,
      ...palavras.filter((w) => w.fim <= r.de + 0.3).map((w) => fimSeguro(w.fim)),
    );
    const b2 = Math.min(
      r.ate,
      ...palavras.filter((w) => w.inicio >= r.ate - 0.3).map((w) => inicioSeguro(w.inicio)),
    );
    if (b2 > a2) cortes.push([a2, b2, "removido"]);
  }

  // 1c) seleções: fica SÓ o intervalo de cada uma (aparado na fala); o resto sai, com ou sem fala.
  //     O limite da seleção nunca corta palavra: o fim vai até a palavra terminar de soar.
  if (selecoes.length > 0) {
    const ordenadas = [...selecoes].sort((x, y) => x.de - y.de || x.ate - y.ate);
    const ficam: Array<[number, number]> = [];
    ordenadas.forEach((s, n) => {
      const idx = palavras.map((w, i) => (dentro(s, meio(w)) ? i : -1)).filter((i) => i >= 0);
      if (idx.length > 0) {
        const primeira = palavras[idx[0]];
        const ultimaIdx = idx[idx.length - 1];
        const ultima = palavras[ultimaIdx];
        let st = inicioSeguro(primeira.inicio);
        let en = fimSeguro(ultima.fim);
        if (n === 0) st = Math.max(0, Math.min(st, primeira.inicio - ritmo.folgaInicio));
        if (n === ordenadas.length - 1) {
          // cauda do vídeo, sem pegar o começo da palavra seguinte
          const seguintes = palavras
            .filter((w, i) => w.inicio > ultima.fim - 0.01 && i !== ultimaIdx)
            .map((w) => w.inicio);
          const teto = seguintes.length > 0 ? Math.min(...seguintes) - 0.04 : total;
          en = Math.min(total, Math.max(en, Math.min(ultima.fim + ritmo.folgaFim, teto)));
        }
        ficam.push([st, en]);
      } else {
        ficam.push([s.de, s.ate]); // trecho só de imagem (b-roll): fica inteiro
      }
    });
    let t = 0;
    for (const [a, b] of ficam) {
      if (a > t) cortes.push([t, a, "removido"]);
      t = Math.max(t, b);
    }
    cortes.push([t, total, "fim"]);
  }

  // 2) pausas longas dentro da fala mantida (mais respiro depois da fala do que antes da próxima)
  const primeiraFala = palavras[mantidas[0]].inicio;
  const ultimaFala = palavras[mantidas[mantidas.length - 1]].fim;
  const depois = ritmo.pausaQueFica * 0.6;
  const antes = ritmo.pausaQueFica * 0.4;
  // 2a) vão entre duas palavras mantidas: só é pausa se pelo menos 85% dele for silêncio
  //     (som não transcrito, tipo alguém falando ou barulho do produto, não é pausa)
  for (let m = 0; m + 1 < mantidas.length; m++) {
    const a = mantidas[m];
    const b = mantidas[m + 1];
    if (b !== a + 1) continue; // tem remoção no meio, já tratada
    const ga = palavras[a].fim;
    const gb = palavras[b].inicio;
    if (gb - ga <= ritmo.pausaMaxima) continue;
    const de = Math.trunc(ga * 100);
    const ate = Math.min(db.length, Math.trunc(gb * 100));
    let quietas = 0;
    for (let k = de; k < ate; k++) if (db[k] < limiar) quietas++;
    if (ate > de && quietas / (ate - de) >= 0.85) {
      const ca = Math.max(ga + depois, fimSeguro(ga));
      const cb = Math.min(gb - antes, inicioSeguro(gb));
      if (cb - ca > 0.1) cortes.push([ca, cb, "pausa"]);
    }
  }
  // 2b) silêncio escondido dentro de uma palavra "esticada" pelo transcritor (ex.: uma palavra com 2,6 s)
  const meiosDePalavraCurta = palavras.filter((w) => w.fim - w.inicio < 0.8).map(meio);
  for (const [ss, se] of silencios) {
    if (se <= primeiraFala || ss >= ultimaFala || se - ss <= ritmo.pausaMaxima) continue;
    if (meiosDePalavraCurta.some((m) => ss + 0.05 < m && m < se - 0.05)) continue; // fala baixa, não corta
    cortes.push([ss + depois, se - antes, "pausa"]);
  }

  // 3) início e fim
  // O vídeo COMEÇA FALANDO. O início do transcritor vem cedo (até 0,3 s), então quem manda é o áudio:
  // entra uns 0,1 s antes da voz subir.
  function subidaDaVoz(inicio: number): number {
    const a0 = Math.trunc(Math.max(0, inicio - 0.4) * 100);
    const b0 = Math.min(db.length, Math.trunc(Math.min(total, inicio + 0.8) * 100));
    if (b0 <= a0) return inicio;
    let pico = -Infinity;
    for (let k = a0; k < b0; k++) pico = Math.max(pico, db[k]);
    const corte = Math.max(limiar + 6, pico - 12);
    let k = a0;
    while (k < b0 && db[k] < corte) k++;
    return k < b0 ? k / 100 : inicio;
  }
  const aberturaDaVoz = subidaDaVoz(primeiraFala);
  const comeco = Math.max(0, aberturaDaVoz - FOLGA_ABERTURA);
  const depoisDaUltima = palavras.slice(mantidas[mantidas.length - 1] + 1).map((w) => w.inicio);
  const fimDoVideo = Math.min(
    total,
    Math.max(
      fimSeguro(ultimaFala),
      Math.min(
        ultimaFala + ritmo.folgaFim,
        depoisDaUltima.length > 0 ? depoisDaUltima[0] - 0.04 : total,
      ),
    ),
  );
  cortes.push([0, comeco, "inicio"]);
  cortes.push([fimDoVideo, total, "fim"]);
  const unidos = unir(cortes.filter((c) => c[1] - c[0] > 0.02));

  // trechos mantidos = complemento dos cortes
  const bruto: Array<{ origem: [number, number]; corteDepois: string | null }> = [];
  let t = 0;
  for (const [a, b, porque] of unidos) {
    if (a - t >= TRECHO_MINIMO)
      bruto.push({ origem: [arredondar(t, 3), arredondar(a, 3)], corteDepois: porque });
    t = Math.max(t, b);
  }
  if (total - t >= TRECHO_MINIMO)
    bruto.push({ origem: [arredondar(t, 3), arredondar(total, 3)], corteDepois: null });

  // transição na troca de assunto: do item de uma seleção (entra nele) ou de uma remoção (no corte dela)
  const transicoes = new Map<number, TransicaoCorte>();
  for (let k = 1; k < bruto.length; k++) {
    const vaoA = bruto[k - 1].origem[1];
    const vaoB = bruto[k].origem[0];
    for (const item of selecoes) {
      if (
        item.transicao &&
        item.de - 0.5 <= vaoB &&
        vaoB <= item.ate &&
        !(item.de <= vaoA - 0.05 && vaoA - 0.05 <= item.ate)
      ) {
        transicoes.set(k, item.transicao);
      }
    }
    for (const item of remocoes) {
      if (item.transicao && item.de < vaoB && item.ate > vaoA) transicoes.set(k, item.transicao);
    }
  }

  // zoom alternado só em jump cut (opcional: em câmera andando costuma ser desnecessário)
  const zoom = config.zoomEmCortes ?? 0;
  let destino = 0;
  let alterna = false;
  const trechos: Trecho[] = bruto.map((s, k) => {
    const d = s.origem[1] - s.origem[0];
    const faixa: [number, number] = [arredondar(destino, 3), arredondar(destino + d, 3)];
    if (zoom && k > 0 && ["pausa", "removido"].includes(bruto[k - 1].corteDepois ?? ""))
      alterna = !alterna;
    destino += d;
    const trecho: Trecho = {
      origem: s.origem,
      corteDepois: s.corteDepois,
      destino: faixa,
      escala: zoom && alterna ? 1 + zoom : 1,
    };
    const transicao = transicoes.get(k);
    if (transicao) trecho.transicaoEntrada = transicao;
    return trecho;
  });

  // 4) checagem de corte: nenhum trecho pode terminar com a fala ainda soando
  const alertas: string[] = [];
  trechos.forEach((s, k) => {
    const [a, b] = s.origem;
    const dentroDoTrecho = palavras
      .map((w, n) => (conjuntoMantidas.has(n) && a <= meio(w) && meio(w) <= b ? n : -1))
      .filter((n) => n >= 0);
    if (dentroDoTrecho.length === 0) return;
    const ultimoIdx = dentroDoTrecho[dentroDoTrecho.length - 1];
    const ultima = palavras[ultimoIdx];
    const proxima = ultimoIdx + 1 < palavras.length ? palavras[ultimoIdx + 1] : null;
    const colada = proxima !== null && proxima.inicio - ultima.fim < 0.12; // colada na próxima: inevitável
    const soando =
      dbSuave[Math.min(dbSuave.length - 1, Math.trunc(b * 100) - 2)] >= pisoDeFala(ultima.fim) + 3;
    if (!colada && soando && b < ultima.fim + 0.4) {
      // depois de 0,4 s o que soa é ambiente
      alertas.push(`trecho ${k + 1}: corte em ${b.toFixed(2)}s com "${ultima.texto}" ainda soando`);
    }
    if (b >= total - 0.05 && ultima.fim > total - 0.3) {
      alertas.push(
        `a gravacao termina colada em "${ultima.texto}" (${(total - ultima.fim).toFixed(2)}s depois): ` +
          "a palavra pode estar cortada na origem. Considere terminar na frase anterior.",
      );
    }
  });

  // 5) respiro no final: segura o último quadro parado. Se a gravação já tem respiro natural
  //    depois da última palavra, não congela quadro.
  const natural = trechos.length > 0 ? trechos[trechos.length - 1].origem[1] - ultimaFala : 0;
  const respiroFinal = config.respiroFinal ?? (natural >= RESPIRO_NATURAL ? 0 : RESPIRO_PADRAO);

  return {
    limiarSilencioDb: arredondar(limiar, 1),
    duracao: arredondar(destino, 3),
    respiroFinal,
    duracaoOrigem: arredondar(total, 3),
    trechos,
    alertas,
    palavrasMantidas: mantidas,
  };
}
