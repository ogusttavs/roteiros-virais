import { notFound, redirect } from "next/navigation";

import { hojeISO } from "@/lib/config";
import { conviteDeInstalarPodeAparecer } from "@/lib/convite-instalar";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario, marcasDoUsuario, preferenciasDoUsuario } from "@/servicos/clientes";
import { momentoDoRoteiro } from "@/servicos/em-alta";
import { falaDoRoteiro } from "@/servicos/marcar-fala";
import { noticiaDeOrigemDoRoteiro } from "@/servicos/noticias";
import { diaPorExtenso, enderecoHttpsSeguro } from "@/servicos/noticias-assuntos";
import { videoPorId } from "@/servicos/pesquisa";
import { blocosParaLeitura, corpoDoRoteiro, roteiroPorId, versoesDoRoteiro } from "@/servicos/roteiro";
import { grupoDoRoteiro } from "@/servicos/versoes";

import { RoteiroTela } from "./RoteiroTela";

type Props = { params: Promise<{ id: string }> };

/** `/roteiros/[id]` (etapa 11, brief-frontend.md 6.5; `RoteiroTela.dc.html`). */
export default async function Roteiro({ params }: Props) {
  const { id } = await params;
  const roteiroId = idDaRotaOuNulo(id);

  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  if (roteiroId === null) {
    notFound();
  }

  const roteiro = await roteiroPorId(roteiroId, cliente.id);
  if (!roteiro) {
    redirect("/hoje");
  }

  const preferencias = await preferenciasDoUsuario(sessao.user.id);
  const [video, versoes, momento, grupoDeVersoes] = await Promise.all([
    roteiro.referenciaVideoId ? videoPorId(roteiro.referenciaVideoId) : Promise.resolve(null),
    versoesDoRoteiro(roteiroId),
    // E55 PR 2b: o roteiro que nasceu de um assunto em alta diz se o assunto ainda está em alta (selo e linha de prazo) ou já passou (selo neutro e aviso). Uma falha aqui só tira o selo.
    roteiro.temaDoMomento
      ? momentoDoRoteiro({ data: roteiro.data, temaDoMomento: roteiro.temaDoMomento }, hojeISO()).catch(() => null)
      : Promise.resolve(null),
    // E26 4b: se o roteiro nasceu de uma comparação de versões, as outras continuam guardadas e a tela leva a elas. Uma falha aqui só tira o link.
    // Um grupo de uma versão só não tem "outras" para mostrar.
    grupoDoRoteiro(cliente.id, roteiroId).then((g) => (g && g.total > 1 ? g : null)).catch(() => null),
  ]);

  // E53 (parte 3): de onde o roteiro veio, quando nasceu de uma notícia: a de um assunto da marca (a cópia que o roteiro guardou) ou a do setor (a linha da tabela). O link é revalidado (só https).
  const noticiaDoSetor = !roteiro.noticiaDoAssunto && roteiro.noticiaId ? await noticiaDeOrigemDoRoteiro(roteiro.noticiaId) : null;
  const noticiaDeOrigem = roteiro.noticiaDoAssunto
    ? {
        titulo: roteiro.noticiaDoAssunto.titulo,
        veiculo: roteiro.noticiaDoAssunto.veiculo,
        url: enderecoHttpsSeguro(roteiro.noticiaDoAssunto.url),
        dia: roteiro.noticiaDoAssunto.publicadoEm ? diaPorExtenso(new Date(roteiro.noticiaDoAssunto.publicadoEm)) : null,
      }
    : noticiaDoSetor
      ? { titulo: noticiaDoSetor.titulo, veiculo: noticiaDoSetor.fonte ?? "", url: enderecoHttpsSeguro(noticiaDoSetor.url), dia: noticiaDoSetor.publicadoEm ? diaPorExtenso(noticiaDoSetor.publicadoEm) : null }
      : null;

  return (
    <RoteiroTela
      // As marcas guardadas (com o registro do conserto) ficam no servidor: a tela recebe só `fala`.
      roteiro={{ ...roteiro, marcasDeFala: null }}
      noticiaDeOrigem={noticiaDeOrigem}
      corpo={corpoDoRoteiro(roteiro)}
      blocos={blocosParaLeitura(roteiro)}
      video={video}
      versoes={versoes}
      momento={momento}
      grupoDeVersoes={grupoDeVersoes}
      fala={falaDoRoteiro(roteiro, sessao.verComo != null)}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
      conviteInstalarPodeAparecer={conviteDeInstalarPodeAparecer(preferencias, new Date())}
    />
  );
}
