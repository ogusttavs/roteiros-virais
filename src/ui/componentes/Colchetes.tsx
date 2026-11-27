/**
 * O espaço para completar na leitura do roteiro e no modo gravação (26/11/2026): quando falta um fato que a IA não pode inventar (telefone, horário, endereço), ela escreve o trecho entre
 * colchetes ("[telefone da clínica]"). O carrossel e a capa já destacavam o trecho; aqui o mesmo destaque vale para a fala, com a mesma regra de `@/carrossel/colchetes`. Só desenha: o
 * texto que a pessoa lê continua letra por letra o do roteiro (o `<mark>` só embrulha), e nada do que está salvo muda.
 */
import { dividirPorColchetes } from "@/carrossel/colchetes";

import styles from "./Colchetes.module.css";

/** Onde fica um trecho entre colchetes no texto inteiro: a posição do "[" e a posição logo depois do "]". */
export type IntervaloDeColchete = { inicio: number; fim: number };

/** As posições dos trechos entre colchetes do texto, na ordem, pela mesma regra do carrossel (colchete vazio ou quebrado em linhas não conta). */
export function intervalosDeColchetes(texto: string): IntervaloDeColchete[] {
  const intervalos: IntervaloDeColchete[] = [];
  let posicao = 0;
  for (const parte of dividirPorColchetes(texto)) {
    if (parte.colchete) intervalos.push({ inicio: posicao, fim: posicao + parte.texto.length });
    posicao += parte.texto.length;
  }
  return intervalos;
}

/** Uma parte de um pedaço do texto: se está dentro de um trecho entre colchetes e, nesse caso, se é ela que abre o trecho ("[") e se é ela que o fecha ("]"). */
export type ParteDoPedaco = { texto: string; colchete: boolean; abre: boolean; fecha: boolean };

/**
 * Um pedaço do texto (que começa na posição `inicio` do texto inteiro) cortado onde entram e saem os trechos entre colchetes. Serve à fala marcada, em que um mesmo trecho pode estar
 * repartido entre uma palavra solta, uma palavra de peso e a caixa que prende a pausa: cada parte sabe se abre ou fecha o trecho, para o destaque não ganhar borda no meio dele.
 */
export function cortarNosColchetes(pedaco: string, inicio: number, intervalos: IntervaloDeColchete[]): ParteDoPedaco[] {
  const fimDoPedaco = inicio + pedaco.length;
  const partes: ParteDoPedaco[] = [];
  let cursor = inicio;
  for (const intervalo of intervalos) {
    if (intervalo.fim <= cursor || intervalo.inicio >= fimDoPedaco) continue;
    const de = Math.max(intervalo.inicio, cursor);
    const ate = Math.min(intervalo.fim, fimDoPedaco);
    if (de > cursor) partes.push({ texto: pedaco.slice(cursor - inicio, de - inicio), colchete: false, abre: false, fecha: false });
    partes.push({ texto: pedaco.slice(de - inicio, ate - inicio), colchete: true, abre: de === intervalo.inicio, fecha: ate === intervalo.fim });
    cursor = ate;
  }
  if (cursor < fimDoPedaco) partes.push({ texto: pedaco.slice(cursor - inicio), colchete: false, abre: false, fecha: false });
  return partes;
}

/** Um pedaço do texto com o que cai dentro de um trecho entre colchetes destacado. Sem colchete no pedaço, é só o texto. */
export function PedacoComColchetes({ texto, inicio, intervalos }: { texto: string; inicio: number; intervalos: IntervaloDeColchete[] }) {
  return (
    <>
      {cortarNosColchetes(texto, inicio, intervalos).map((parte, i) =>
        parte.colchete ? (
          <mark key={i} className={[styles.colchete, parte.abre ? styles.abre : "", parte.fecha ? styles.fecha : ""].filter(Boolean).join(" ")} data-colchete>
            {parte.texto}
          </mark>
        ) : (
          parte.texto
        ),
      )}
    </>
  );
}

/** O texto com os trechos entre colchetes destacados (o espaço para completar antes de gravar). Sem colchete, é só o texto. */
export function TextoComColchetes({ texto }: { texto: string }) {
  const intervalos = intervalosDeColchetes(texto);
  if (intervalos.length === 0) return <>{texto}</>;
  return <PedacoComColchetes texto={texto} inicio={0} intervalos={intervalos} />;
}
