/**
 * A frase que diz por que uma fonte (site, Instagram, YouTube) não foi lida na seção "O que a IA tirou
 * das suas redes e do seu site" (E38 PR 2). Pura e sem servidor, para o cartão (que roda no cliente) e
 * os testes. O TikTok nunca gera frase aqui: a seção tem uma frase própria para ele.
 */
import type { FonteDoContexto } from "@/db/schema";
import { textosBriefing } from "@/textos/briefing";

const t = textosBriefing.contextoDaMarca;
const NOME_DA_REDE = { instagram: "Instagram", youtube: "YouTube" } as const;

export function fraseDaFonteNaoLida(fonte: FonteDoContexto): string | null {
  if (fonte.lida || fonte.tipo === "tiktok") return null;
  if (fonte.tipo === "site") return t.naoLida.site[fonte.motivo ?? ""] ?? t.naoLida.padraoSite;
  const modelo = t.naoLida.rede[fonte.motivo ?? ""] ?? t.naoLida.padraoRede;
  return modelo.replace("{rede}", NOME_DA_REDE[fonte.tipo]);
}
