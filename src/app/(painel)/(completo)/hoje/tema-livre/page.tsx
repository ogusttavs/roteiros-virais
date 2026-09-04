import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";

import { TemaLivreTela } from "./TemaLivreTela";

type Props = { searchParams: Promise<{ tema?: string }> };

/**
 * `?tema=<assunto>` vem de `/referencias`, "usar como referência" (etapa 12,
 * decisão 1 do `PROXIMO.md`): só preenche o campo, o cliente ainda decide
 * clicar em "avaliar o tema".
 */
export default async function TemaLivre({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const { tema } = await searchParams;
  return <TemaLivreTela notaMinima={config.regras.notaMinimaTema} temaInicial={tema ?? ""} />;
}
