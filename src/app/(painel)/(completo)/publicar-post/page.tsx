import { redirect } from "next/navigation";

import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { listarPostsDaMarca, situacaoDoPostPronto } from "@/servicos/post-pronto";
import { textosPostPronto } from "@/textos/post-pronto";

import { PublicarPostPronto } from "./PublicarPostPronto";

export const dynamic = "force-dynamic";

/** E56 PR 2: "Publicar post pronto": montar um post de imagem ou carrossel e a fila de quem espera a vez. Só aparece com a chave `PUBLICAR_IMAGENS_ATIVO` aberta; o "ver como" só lê. */
export default async function PublicarPost() {
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));

  const situacao = await situacaoDoPostPronto(sessao.user.id, cliente.id);
  // Fechada neste ambiente: a tela não existe (a Conta nem mostra o caminho).
  if (!situacao.pode && situacao.codigo === "fechada") redirect("/conta");
  const posts = await listarPostsDaMarca(cliente.id);
  const verComo = sessao.verComo !== null;
  return (
    <PublicarPostPronto
      situacao={situacao.pode ? { pode: true, conta: situacao.conta } : { pode: false, frase: situacao.frase, levaAConta: ["sem-conta", "sem-permissao", "acesso-perdido"].includes(situacao.codigo) }}
      posts={posts}
      verComo={verComo}
      textoVerComo={textosPostPronto.tela.verComo}
    />
  );
}
