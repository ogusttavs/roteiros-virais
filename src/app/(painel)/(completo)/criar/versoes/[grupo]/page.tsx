import { redirect } from "next/navigation";

import { rotuloParaQue } from "@/config/fichas";
import { config } from "@/lib/config";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import {
  chaveDaNotaDoObjetivo,
  enderecoParaTrocarOObjetivo,
  ordenarVersoes,
  paraVersaoDaTela,
  pedidoDoGrupo,
  versoesDoGrupo,
} from "@/servicos/versoes";
import { textosObjetivo } from "@/textos/objetivo";
import { textosVersoes } from "@/textos/versoes";

import { VersoesTela } from "../VersoesTela";

type Props = { params: Promise<{ grupo: string }> };

const GRUPO_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/criar/versoes/[grupo]` (E26 4b, parte 2): as versões que a pessoa pediu, para ler e escolher. O grupo é escopado pela marca da sessão (o de outra marca é "não achei", e cai no
 * Criar). A ordem é a da nota do objetivo escolhido; a página guarda a ordem da primeira vez, e a tela não a refaz enquanto a pessoa está nela.
 */
export default async function Versoes({ params }: Props) {
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect("/entrar");

  const { grupo } = await params;
  const todas = GRUPO_VALIDO.test(grupo) ? await versoesDoGrupo(cliente.id, grupo) : [];
  if (todas.length === 0) redirect("/criar");

  const primeira = todas[0];
  const ordenadas = ordenarVersoes(todas, primeira.objetivo);
  const pedido = await pedidoDoGrupo(cliente.id, grupo);
  const story = primeira.formato === "story";
  const semFala = !story && primeira.estilo === "sem_fala";
  // O Story e o vídeo sem fala não perguntam para que é o vídeo: não há objetivo para trocar.
  const escolheuOObjetivo = !story && !semFala;
  const formato = story ? textosObjetivo.storyCartao : semFala ? textosVersoes.formatoSemFala : textosObjetivo.reelsCartao;

  return (
    <VersoesTela
      grupo={grupo}
      tema={primeira.tema}
      formato={formato}
      paraQue={rotuloParaQue({ ficha: primeira.ficha, objetivo: primeira.objetivo, formato: story ? "story" : "reels" })}
      chaveDaNota={chaveDaNotaDoObjetivo(primeira.objetivo)}
      escolheuOObjetivo={escolheuOObjetivo}
      trocarObjetivoHref={escolheuOObjetivo && pedido ? enderecoParaTrocarOObjetivo(pedido, { tema: primeira.tema, criadoEm: primeira.criadoEm }) : null}
      versoes={ordenadas.map((v) => paraVersaoDaTela(v))}
      meta={config.regras.notaMinimaTema}
    />
  );
}
