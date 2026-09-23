import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteDaSessaoAtual, marcasDoUsuario } from "@/servicos/clientes";
import { rascunhoTemaLivre, temasParaCliente } from "@/servicos/temas";

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
  const [{ tema }, rascunho, marcas, resultadoTemas] = await Promise.all([
    searchParams,
    rascunhoTemaLivre(sessao.user.id, cliente.id),
    marcasDoUsuario(sessao.user.id),
    temasParaCliente(cliente),
  ]);

  // V9a, item 3 e 4: a mesma folha "Gravar agora" de `/hoje`, com "Estou num momento".
  const objetivoRecomendado = resultadoTemas.status === "ok" ? resultadoTemas.objetivoRecomendado : null;
  const outrasMarcas = marcas.filter((marca) => marca.id !== cliente.id);

  return (
    <TemaLivreTela
      notaMinima={config.regras.notaMinimaTema}
      temaInicial={tema ?? rascunho ?? ""}
      objetivoRecomendado={objetivoRecomendado}
      outrasMarcas={outrasMarcas}
    />
  );
}
