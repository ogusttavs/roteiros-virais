import { Music, Scissors, Type, Eye } from "lucide-react";
import { notFound } from "next/navigation";

import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import { validarTokenImpressao } from "@/lib/tokenImpressao";
import { corpoDoRoteiro, roteiroPorId } from "@/servicos/roteiro";
import { textosRoteiro } from "@/textos/roteiro";
import { BlocoCenas } from "@/ui/componentes/BlocoCenas";
import { BlocoEdicao, type ItemEdicao } from "@/ui/componentes/BlocoEdicao";
import { RoteiroTexto } from "@/ui/componentes/RoteiroTexto";

import styles from "./ImpressaoRoteiro.module.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> };
type Edicao = ReturnType<typeof corpoDoRoteiro>["edicao"];

function splitParagrafos(texto: string): string[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function formatarData(dataISO: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${dataISO}T12:00:00`));
}

/** Mesma composição de `RoteiroTela.tsx`, item a item (sem depender da tela em si). */
function itensEdicao(edicao: Edicao): ItemEdicao[] {
  const textoNaTela =
    edicao.textoNaTela.length > 0
      ? edicao.textoNaTela.map((item) => `${item.quando}, "${item.oQue}", ${item.onde}`).join("; ")
      : textosRoteiro.edicao.semTexto;
  const recursos =
    edicao.recursos.length > 0 ? edicao.recursos.join("; ") : textosRoteiro.edicao.semRecurso;

  return [
    { icone: Type, rotulo: textosRoteiro.edicao.texto, texto: textoNaTela },
    { icone: Scissors, rotulo: textosRoteiro.edicao.corte, texto: edicao.ritmoDeCorte },
    { icone: Eye, rotulo: textosRoteiro.edicao.recursos, texto: recursos },
    {
      icone: Music,
      rotulo: textosRoteiro.edicao.audio,
      texto: edicao.audio ?? textosRoteiro.edicao.semAudio,
    },
  ];
}

/**
 * A página que o Playwright abre para virar PDF (rota `/api/roteiros/[id]/pdf`,
 * achado do primeiro uso no iPad, item 5): fora de `(painel)/`, sem sidebar
 * nem barra de ações, só o roteiro no visual do painel (tokens e fontes do
 * `layout.tsx` raiz, que continuam valendo aqui). Uma página só de leitura,
 * sem a referência (o cartão manda abrir o vídeo numa aba, o que não faz
 * sentido no papel) nem outros estados da tela; título, objetivo, duração,
 * gancho, corpo, fechamento, chamada final, cenas e o bloco de edição, que é
 * o que sobra para o cliente seguir gravando com o papel na mão.
 *
 * Só abre com o token de impressão (`tokenImpressao.ts`): não existe fluxo
 * de sessão de navegador para esta rota, ela nasce e morre dentro da mesma
 * requisição do servidor que gera o PDF.
 */
export default async function ImprimirRoteiro({ params, searchParams }: Props) {
  const { id } = await params;
  const { token } = await searchParams;
  const roteiroId = Number(id);
  if (!Number.isFinite(roteiroId) || !token) notFound();

  const validado = validarTokenImpressao(token, roteiroId);
  if (!validado) notFound();

  const roteiro = await roteiroPorId(roteiroId, validado.clienteId);
  if (!roteiro) notFound();

  const corpo = corpoDoRoteiro(roteiro);

  return (
    <main className={styles.pagina}>
      <header className={styles.cabecalho}>
        <h1 className={styles.titulo}>{corpo.titulo}</h1>
        <p className={styles.meta}>
          <span>{ROTULO_TEMA_CARTAO[roteiro.objetivo]}</span>
          <span>{corpo.duracaoS} s</span>
          <span>{formatarData(roteiro.data)}</span>
        </p>
      </header>

      <RoteiroTexto
        blocos={[
          { rotulo: textosRoteiro.blocos.abertura, paragrafos: [corpo.gancho] },
          { rotulo: textosRoteiro.blocos.meio, paragrafos: splitParagrafos(corpo.corpo) },
          {
            rotulo: textosRoteiro.blocos.fechamento,
            paragrafos: splitParagrafos(corpo.fechamento),
          },
          { rotulo: textosRoteiro.blocos.chamada, paragrafos: [corpo.chamadaFinal] },
        ]}
      />

      <BlocoCenas titulo={textosRoteiro.ondeGravar} cenas={corpo.cenas} />

      <BlocoEdicao titulo={textosRoteiro.comoEditar} itens={itensEdicao(corpo.edicao)} />
    </main>
  );
}
