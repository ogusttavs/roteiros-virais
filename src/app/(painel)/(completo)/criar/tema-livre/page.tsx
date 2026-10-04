import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { formatarFonteEData } from "@/lib/formatarNumero";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteDaSessaoAtual, marcasDoUsuario } from "@/servicos/clientes";
import { noticiaPorId } from "@/servicos/noticias";
import { rascunhoTemaLivre, temasParaCliente } from "@/servicos/temas";

import { TemaLivreTela } from "./TemaLivreTela";

type Props = { searchParams: Promise<{ tema?: string; data?: string; noticiaId?: string }> };

/**
 * `?tema=<assunto>` vem de `/referencias`, "usar como referência" (etapa 12,
 * decisão 1 do `PROXIMO.md`): só preenche o campo, o cliente ainda decide
 * clicar em "avaliar o tema". Vence o rascunho salvo (V5b, item 2): é uma
 * escolha explícita de agora, não um texto esquecido de uma visita anterior.
 *
 * `?noticiaId=<id>` vem de `/noticias`, "Criar vídeo com esta notícia" (E43): escopado pelo nicho
 * do cliente (`noticiaPorId`), nunca confiando num id de outro setor vindo da URL; sem rascunho
 * nem `?tema=` junto (o campo nasce vazio, a pergunta é "o que você pensou", não um assunto).
 */
export default async function TemaLivre({ searchParams }: Props) {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDaSessaoAtual();
  const [{ tema, data, noticiaId }, rascunho, marcas, resultadoTemas] = await Promise.all([
    searchParams,
    rascunhoTemaLivre(sessao.user.id, cliente.id),
    marcasDoUsuario(sessao.user.id),
    temasParaCliente(cliente),
  ]);

  // V9a, item 3 e 4: a mesma folha "Gravar agora" de `/hoje`, com "Estou num momento".
  const objetivoRecomendado = resultadoTemas.status === "ok" ? resultadoTemas.objetivoRecomendado : null;
  const outrasMarcas = marcas.filter((marca) => marca.id !== cliente.id);
  // Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio.
  const dataInicial = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : undefined;

  const noticiaIdNumero = Number(noticiaId);
  const noticiaLinha =
    noticiaId && Number.isInteger(noticiaIdNumero) && cliente.nichoId
      ? await noticiaPorId(noticiaIdNumero, cliente.nichoId)
      : null;
  const noticia = noticiaLinha
    ? {
        id: noticiaLinha.id,
        titulo: noticiaLinha.titulo,
        fonteEData: formatarFonteEData(noticiaLinha.fonte, noticiaLinha.publicadoEm),
      }
    : undefined;

  return (
    <TemaLivreTela
      notaMinima={config.regras.notaMinimaTema}
      temaInicial={noticia ? "" : (tema ?? rascunho ?? "")}
      objetivoRecomendado={objetivoRecomendado}
      outrasMarcas={outrasMarcas}
      tipo={cliente.tipo}
      quemGravaPadrao={cliente.quemGrava}
      dataInicial={dataInicial}
      noticia={noticia}
      marcaAtivaId={cliente.id}
    />
  );
}
