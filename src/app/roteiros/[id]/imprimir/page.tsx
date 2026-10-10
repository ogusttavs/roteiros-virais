import { notFound } from "next/navigation";

import { idDaRotaOuNulo } from "@/lib/id-rota";
import { validarTokenImpressao } from "@/lib/tokenImpressao";
import { clientePorId } from "@/servicos/clientes";
import { folhaDoRoteiro } from "@/servicos/folha-do-roteiro";
import { videoPorId } from "@/servicos/pesquisa";
import { roteiroPorId } from "@/servicos/roteiro";

import { FolhaA4, QuadroDoCelular } from "./FolhaImpressa";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string; formato?: string }> };

/**
 * A página que o Playwright abre para virar PDF (rota `/api/roteiros/[id]/pdf`, `formato=a4`) ou imagem para o celular (rota `/api/roteiros/[id]/imagem`, `formato=celular`), E26, passo 23 do
 * Opus: fora de `(painel)/`, sem barra lateral nem barra de ações, só o roteiro no visual do painel (tokens e fontes do `layout.tsx` raiz, que continuam valendo aqui). Uma página só de
 * leitura, a mesma folha nos dois formatos (`folhaDoRoteiro`): o nome da marca da pessoa e a data no alto (sem a marca do aplicativo, regra 3), o título, o recado do vídeo, o roteiro em
 * blocos com o tempo, "Como editar" e "De onde veio" com o link no segundo.
 *
 * Só abre com o token de impressão (`tokenImpressao.ts`): não existe fluxo de sessão de navegador para esta rota, ela nasce e morre dentro da mesma requisição do servidor que gera o arquivo.
 */
export default async function ImprimirRoteiro({ params, searchParams }: Props) {
  const { id } = await params;
  const { token, formato } = await searchParams;
  const roteiroId = idDaRotaOuNulo(id);
  if (roteiroId === null || !token) notFound();

  const validado = validarTokenImpressao(token, roteiroId);
  if (!validado) notFound();

  const roteiro = await roteiroPorId(roteiroId, validado.clienteId);
  if (!roteiro) notFound();

  const [cliente, video] = await Promise.all([
    clientePorId(validado.clienteId),
    roteiro.referenciaVideoId ? videoPorId(roteiro.referenciaVideoId) : Promise.resolve(null),
  ]);
  const folha = folhaDoRoteiro(roteiro, cliente?.nome ?? "", video);

  return formato === "celular" ? <QuadroDoCelular folha={folha} /> : <FolhaA4 folha={folha} />;
}
