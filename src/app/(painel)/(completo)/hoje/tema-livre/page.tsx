import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { rascunhoTemaLivre } from "@/servicos/temas";

import { TemaLivreTela } from "./TemaLivreTela";

type Props = { searchParams: Promise<{ tema?: string }> };

/**
 * `?tema=<assunto>` vem de `/referencias`, "usar como referência" (etapa 12,
 * decisão 1 do `PROXIMO.md`): só preenche o campo, o cliente ainda decide
 * clicar em "avaliar o tema". Vence o rascunho salvo (V5b, item 2): é uma
 * escolha explícita de agora, não um texto esquecido de uma visita anterior.
 */
export default async function TemaLivre({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDaSessaoAtual();
  const [{ tema }, rascunho] = await Promise.all([searchParams, rascunhoTemaLivre(sessao.user.id, cliente.id)]);

  return <TemaLivreTela notaMinima={config.regras.notaMinimaTema} temaInicial={tema ?? rascunho ?? ""} />;
}
