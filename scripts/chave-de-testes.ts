/**
 * A chave de API dos testes (decisão do Gustavo, 05/10/2026): os scripts que gastam de verdade (`avaliar:*`, `reclassificar-formato`, `golden-producao`) leem `ANTHROPIC_API_KEY_TESTES`
 * quando ela existe, para o gasto dos testes ficar numa chave e numa conta de uso separadas da de produção; sem ela, usam a chave normal e avisam no cabeçalho. A chave de produção
 * nunca é lida daqui para outro lugar, nunca é escrita em arquivo e este módulo só mexe no ambiente do PRÓPRIO processo do script (o app e o worker nunca o importam).
 *
 * Importado como PRIMEIRO import de cada script (`import "./chave-de-testes";`): a configuração do app lê a chave no momento em que é carregada.
 */
import "dotenv/config";

export type EscolhaDeChave =
  | { fonte: "testes"; chave: string; aviso: string }
  | { fonte: "normal"; chave: string; aviso: string }
  | { fonte: "nenhuma"; chave: ""; aviso: string };

/** Qual chave vale: a de testes, se existir; senão a normal (com aviso); senão nenhuma (o app cai em mock). Pura, para testar. */
export function escolherChaveDeTestes(ambiente: Record<string, string | undefined>): EscolhaDeChave {
  const testes = (ambiente.ANTHROPIC_API_KEY_TESTES ?? "").trim();
  if (testes) return { fonte: "testes", chave: testes, aviso: "chave em uso: ANTHROPIC_API_KEY_TESTES (a chave de testes, separada da de producao)" };
  const normal = (ambiente.ANTHROPIC_API_KEY ?? "").trim();
  if (normal) return { fonte: "normal", chave: normal, aviso: "chave em uso: ANTHROPIC_API_KEY (a normal; defina ANTHROPIC_API_KEY_TESTES para separar o gasto dos testes)" };
  return { fonte: "nenhuma", chave: "", aviso: "sem chave de API: as chamadas saem em mock, sem custo" };
}

const escolha = escolherChaveDeTestes(process.env);
if (escolha.fonte === "testes") process.env.ANTHROPIC_API_KEY = escolha.chave;
console.error(`[${escolha.aviso}]`);
