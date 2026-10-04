"use client";

import { Filter, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import { formatoPorChave } from "@/config/formatos";
import { TAMANHO_PAGINA_TODOS_PADRAO } from "@/config/referencias";
import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { ROTULO_FORMATO, ROTULO_TIPO_CONTEUDO_FILTRAVEL } from "@/ia/enums";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import type { ContagensFiltroReferencias, OrdemReferencias, TipoConteudoFiltravel, VideoReferencia } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import { Botao } from "@/ui/componentes/Botao";
import { ReferenciaCartao, type VideoFormatado } from "@/ui/componentes/ReferenciaCartao";
import { Toast } from "@/ui/componentes/Toast";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { desfavoritarAction, favoritarAction } from "./acoes";
import { FolhaDetalhesVideo } from "./FolhaDetalhesVideo";
import { FolhaFiltrarReferencias } from "./FolhaFiltrarReferencias";
import { PilulaDeRamo } from "./PilulaDeRamo";
import { PilulaOrdem, PilulasFiltroReferencias } from "./PilulasFiltroReferencias";
import styles from "./ReferenciasTela.module.css";

export type Segmento = "foradacurva" | "todos" | "salvos";

type Props = {
  videos: VideoReferencia[];
  total: number;
  favoritosIniciais: number[];
  segmento: Segmento;
  periodoDias: number;
  busca: string;
  plataformasAtivas: Plataforma[];
  formatosAtivos: AnaliseVideo["formato"][];
  /** R2b, item 2: `undefined` é "mais recentes", o padrão de sempre. */
  ordem?: OrdemReferencias;
  viewsMin?: number;
  comFala?: boolean;
  brasil?: boolean;
  tiposConteudo: TipoConteudoFiltravel[];
  /** R2b, item 1: quantos vídeos "Todos" já pediu (cresce de `TAMANHO_PAGINA_TODOS_PADRAO` em `TAMANHO_PAGINA_TODOS_PADRAO`, nunca com offset: ver `page.tsx`). */
  quantidade: number;
  contagensFiltro: ContagensFiltroReferencias;
  /** V12b, item 8: a rede principal da marca não tinha vídeo no período, então a tela mostrou todas em vez dela. */
  redePrincipalSemVideo?: Plataforma;
  /** M1, item 5: o setor tem vídeo coletado mas a análise ainda não rodou; troca o "vazio" de sempre por essa explicação. */
  aindaLendo?: boolean;
  /** E45 PR 3: os ramos da conta (o principal primeiro); só vem com mais de um, e então a pílula "Ramo" aparece. */
  ramos?: { id: number; nome: string; principal: boolean }[];
  /** E45 PR 3: o ramo que a pílula escolheu (`?ramo=` na URL); `undefined` é "todos os ramos". */
  ramoAtivo?: number;
};

const ROTULO_PLATAFORMA: Record<Plataforma, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function formatarVideo(v: VideoReferencia, nomesDosAlternativos: Map<number, string>): VideoFormatado {
  const faixa = classificarMultiplo(v.foraDaCurva);
  return {
    id: v.id,
    url: v.url,
    multiplo: formatarMultiplo(v.foraDaCurva),
    rotuloMultiplo: rotuloMultiploConta(faixa, v.contaMedianaOrigem),
    faixaMultiplo: faixa,
    views: v.views,
    medianaConta: v.medianaConta,
    velocidade: v.velocidade,
    contaNome: v.contaNome ?? v.contaHandle ?? textosReferencias.contaNaoIdentificada,
    plataformaData: v.publicadoEm
      ? `${ROTULO_PLATAFORMA[v.plataforma]}, ${FORMATAR_DATA.format(v.publicadoEm)}`
      : ROTULO_PLATAFORMA[v.plataforma],
    titulo: v.titulo,
    assunto: v.assunto,
    gancho: v.gancho,
    estrutura: v.estrutura,
    porQueFuncionou: v.porQueFuncionou,
    capaUrl: v.capaUrl,
    semFala: v.semFala === true,
    segundoChave: v.segundoChave,
    abaixoDaRegua: v.abaixoDaRegua,
    tipoConteudo: v.tipoConteudo,
    ramoNome: v.nichoId === null ? undefined : nomesDosAlternativos.get(v.nichoId),
    // E44 PR 2: o tipo de vídeo, só para os treze do cliente (recorte de outro, notícia, ao vivo e "outro" não ganham selo).
    tipoDeVideo: formatoPorChave(v.formatoCatalogo)?.nome,
  };
}

/** "no Instagram", "no Instagram e no YouTube", "no Instagram, no YouTube e no TikTok". */
function juntarPlataformas(plataformas: Plataforma[]): string {
  const nomes = plataformas.map((p) => `no ${ROTULO_PLATAFORMA[p]}`);
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

type Filtros = {
  segmento: Segmento;
  periodoDias: number;
  busca: string;
  plataformas: Plataforma[];
  formatos: AnaliseVideo["formato"][];
  ordem: OrdemReferencias | undefined;
  viewsMin: number | undefined;
  comFala: boolean | undefined;
  brasil: boolean | undefined;
  tiposConteudo: TipoConteudoFiltravel[];
  /** R2b, item 1: só o segmento "Todos" usa; nas outras duas abas fica sempre no padrão. */
  quantidade: number;
  /** E45 PR 3: a pílula "Ramo" (o id do setor); `undefined` é todos. */
  ramo?: number;
};

/** "sim"/"nao" na URL, mesma codificação de `page.tsx`. */
function paramBooleano(valor: boolean | undefined): string | undefined {
  if (valor === true) return "sim";
  if (valor === false) return "nao";
  return undefined;
}

function montarUrl(filtros: Filtros): string {
  const params = new URLSearchParams();
  if (filtros.segmento !== "foradacurva") params.set("seg", filtros.segmento);
  const periodoPadrao = filtros.segmento === "todos" ? 90 : 7;
  if (filtros.periodoDias !== periodoPadrao) params.set("periodo", String(filtros.periodoDias));
  if (filtros.busca.trim()) params.set("busca", filtros.busca.trim());
  /**
   * `plataforma=todas` explícito quando a lista fica vazia, nunca omitido
   * (V12b, item 8): sem isso, a próxima navegação que não mexesse em
   * plataforma (busca, período) voltava a cair no padrão da rede principal
   * de `page.tsx`, e "Limpar os filtros" não limpava de verdade.
   */
  params.set("plataforma", filtros.plataformas.length > 0 ? filtros.plataformas.join(",") : "todas");
  if (filtros.formatos.length > 0) params.set("formato", filtros.formatos.join(","));
  // R2b, item 2: os cinco filtros novos, e a ordem, valem nos três segmentos; "Ver mais" (item 1) só no "Todos".
  if (filtros.ordem) params.set("ordem", filtros.ordem);
  if (filtros.viewsMin !== undefined) params.set("views", String(filtros.viewsMin));
  const fala = paramBooleano(filtros.comFala);
  if (fala) params.set("fala", fala);
  const brasil = paramBooleano(filtros.brasil);
  if (brasil) params.set("brasil", brasil);
  if (filtros.tiposConteudo.length > 0) params.set("tipo", filtros.tiposConteudo.join(","));
  if (filtros.ramo !== undefined) params.set("ramo", String(filtros.ramo));
  if (filtros.segmento === "todos" && filtros.quantidade !== TAMANHO_PAGINA_TODOS_PADRAO) {
    params.set("quantidade", String(filtros.quantidade));
  }
  const query = params.toString();
  return query ? `/referencias?${query}` : "/referencias";
}

/**
 * `/referencias` (V6, D2 parte 3a; design v2, `Referencias.dc.html`, estados
 * `normal`, `filtrar`, `detalhes`, `vazio`, `erro`; `todos`, `todosFiltrar` e
 * `noticias` ficam para a parte 3b). Os filtros vivem na URL; esta tela só
 * cuida de interação (folhas, favoritar otimista) e monta a URL nova ao
 * aplicar um filtro, deixando o Server Component (`page.tsx`) reconsultar.
 *
 * V7, celular e rede ruim: o botão Voltar fecha as duas folhas em vez de sair
 * da tela; toda navegação mostra andamento e, sem rede, só avisa; o aviso de
 * "salvo" só sai depois que o servidor respondeu.
 */
export function ReferenciasTela({
  videos,
  total,
  favoritosIniciais,
  segmento,
  periodoDias,
  busca,
  plataformasAtivas,
  formatosAtivos,
  ordem,
  viewsMin,
  comFala,
  brasil,
  tiposConteudo,
  quantidade,
  contagensFiltro,
  redePrincipalSemVideo,
  aindaLendo,
  ramos,
  ramoAtivo,
}: Props) {
  const router = useRouter();
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [campoBusca, setCampoBusca] = useState(busca);
  const [folhaFiltrarAberta, setFolhaFiltrarAberta] = useState(false);
  /**
   * Passo 14: as pílulas de filtro à vista, do tablet deitado para cima; a folha "Filtrar"
   * continua a mesma abaixo disso. Uma string só para todas as sete pílulas (as seis do grupo
   * mais a de "Ordem", que mora perto da contagem): só uma aberta por vez.
   */
  const [pilulaAberta, setPilulaAberta] = useState<string | null>(null);
  const [videoDetalheId, setVideoDetalheId] = useState<number | null>(null);
  const [favoritos, setFavoritos] = useState(() => new Set(favoritosIniciais));
  const [aviso, setAviso] = useState<{ id: number; texto: string; variante: "sucesso" | "erro" } | null>(null);
  /** Cada aviso ganha um número: o `Toast` remonta (`key`) e reinicia o tempo, em vez de o aviso novo herdar o que restava do anterior. */
  const contadorDeAvisos = useRef(0);
  function mostrarAviso(texto: string, variante: "sucesso" | "erro") {
    contadorDeAvisos.current += 1;
    setAviso({ id: contadorDeAvisos.current, texto, variante });
  }
  // O texto que explica o que "salvar" faz sai só na primeira vez que um salvar dá certo.
  const jaMostrouToast = useRef(false);
  const [idsPendentes, setIdsPendentes] = useState<Set<number>>(() => new Set());
  const [, iniciarTransicao] = useTransition();
  // A navegação (abas, busca, período, filtros) tem a transição própria: o andamento dela não acende o do salvar.
  const [navegando, iniciarNavegacao] = useTransition();
  // Aba e período mostram a escolha na hora; o valor de verdade chega com a página nova e a tela volta a ele sozinha.
  const [segmentoExibido, setSegmentoOtimista] = useOptimistic(segmento);
  const [periodoExibido, setPeriodoOtimista] = useOptimistic(periodoDias);
  /**
   * F1, item 3 (modo B): a folha "Filtrar" nasce de `plataformasAtivas`/`formatosAtivos`, as props
   * confirmadas pelo servidor. Se ela reabrir enquanto uma navegação anterior ainda não voltou (o
   * "Limpar" de uma volta anterior, por exemplo), essas props continuam com o valor de ANTES daquela
   * navegação, e a folha nasce marcada com o que já foi pedido, não com o que está na tela. A pessoa
   * então desmarca o que já estava pedindo para sumir, "Ver os N vídeos" monta a mesma URL que já está
   * pendente, e a chamada nova é descartada (`navegar` só bloqueia URL igual à pendente) ou, pior, as
   * duas chamadas ficam em voo e a que volta por último decide a URL final, não a mais recente (achado
   * do CI, `referencias.spec.ts:316`, volta 4: pediu tiktok, ficou todas). Otimista junto de
   * `segmentoOtimista` e `periodoOtimista`: a folha sempre nasce do que foi pedido, nunca do que ainda
   * não voltou.
   */
  const [plataformasExibidas, setPlataformasOtimista] = useOptimistic(plataformasAtivas);
  const [formatosExibidos, setFormatosOtimista] = useOptimistic(formatosAtivos);
  // R2b, item 2: mesmo raciocínio acima para os cinco filtros novos, e para `quantidade` (item 1, "Ver mais").
  const [ordemExibida, setOrdemOtimista] = useOptimistic(ordem);
  const [viewsMinExibido, setViewsMinOtimista] = useOptimistic(viewsMin);
  const [comFalaExibido, setComFalaOtimista] = useOptimistic(comFala);
  const [brasilExibido, setBrasilOtimista] = useOptimistic(brasil);
  const [tiposConteudoExibidos, setTiposConteudoOtimista] = useOptimistic(tiposConteudo);
  const [quantidadeExibida, setQuantidadeOtimista] = useOptimistic(quantidade);
  const urlPendente = useRef<string | null>(null);
  /**
   * F1, ajuste A da revisão do PR #71: a rede de segurança do item 2 (mais abaixo, em `navegar`) nunca
   * era desarmada. Provado pelo Fable: entrar em Referências, aplicar um filtro, sair para outra tela
   * em menos de 6s, e a pessoa era puxada de volta sozinha, porque o temporizador disparava do mesmo
   * jeito e `urlPendente` continuava com a última URL pedida, ainda que a navegação tivesse dado certo
   * havia tempo. Os dois refs guardam o temporizador da rede de segurança e o do aviso de demora
   * (`demorando`), para os dois poderem ser desarmados por três caminhos: a URL pedida chegar (o efeito
   * abaixo, que olha as props confirmadas pelo servidor, não o estado otimista), outra navegação ser
   * pedida (limpos no começo de `navegar`), ou a tela desmontar.
   */
  const redeDeSegurancaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisoDemoraRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [demorando, setDemorando] = useState(false);
  const limparRedeDeSeguranca = useCallback(() => {
    if (redeDeSegurancaRef.current) {
      clearTimeout(redeDeSegurancaRef.current);
      redeDeSegurancaRef.current = null;
    }
    if (avisoDemoraRef.current) {
      clearTimeout(avisoDemoraRef.current);
      avisoDemoraRef.current = null;
    }
    setDemorando(false);
  }, []);
  // Desarma quando desmonta (a pessoa saiu de Referências antes da URL chegar ou antes dos 6s).
  useEffect(() => limparRedeDeSeguranca, [limparRedeDeSeguranca]);
  // Desarma quando a URL pedida chega de verdade: as props abaixo só mudam com o servidor confirmando.
  useEffect(() => {
    const urlConfirmada = montarUrl({
      segmento,
      periodoDias,
      busca,
      plataformas: plataformasAtivas,
      formatos: formatosAtivos,
      ordem,
      viewsMin,
      comFala,
      brasil,
      tiposConteudo,
      quantidade,
      ramo: ramoAtivo,
    });
    if (urlPendente.current === urlConfirmada) {
      urlPendente.current = null;
      limparRedeDeSeguranca();
    }
  }, [
    segmento,
    periodoDias,
    busca,
    plataformasAtivas,
    formatosAtivos,
    ordem,
    viewsMin,
    comFala,
    brasil,
    tiposConteudo,
    quantidade,
    ramoAtivo,
    limparRedeDeSeguranca,
  ]);
  // Qual vídeo está na folha agora, para um salvar que termina tarde não fechar a folha de outro (ou a de filtros).
  const detalheAtual = useRef<number | null>(null);
  useEffect(() => {
    detalheAtual.current = videoDetalheId;
  });

  // O botão Voltar do celular fecha a folha em vez de sair da tela (V7, item 1 do PROXIMO.md): uma chamada por folha.
  const detalhes = useFolhaNoHistorico(videoDetalheId !== null, () => setVideoDetalheId(null));
  const filtrar = useFolhaNoHistorico(folhaFiltrarAberta, () => setFolhaFiltrarAberta(false));
  const fecharAviso = useCallback(() => setAviso(null), []);

  const formatados = useMemo(() => {
    const nomes = new Map((ramos ?? []).filter((r) => !r.principal).map((r) => [r.id, r.nome] as const));
    return videos.map((v) => formatarVideo(v, nomes));
  }, [videos, ramos]);
  const videoDetalhe = formatados.find((v) => v.id === videoDetalheId) ?? null;
  const urlDetalhe = videos.find((v) => v.id === videoDetalheId)?.url ?? null;

  /**
   * R2b, item 2: a ordem não conta aqui (não é um filtro, é como a lista é ordenada; o desenho só
   * conta o que de fato reduz quantos vídeos aparecem).
   */
  const quantosFiltrosAtivos =
    plataformasExibidas.length +
    formatosExibidos.length +
    tiposConteudoExibidos.length +
    (viewsMinExibido !== undefined ? 1 : 0) +
    (comFalaExibido !== undefined ? 1 : 0) +
    (brasilExibido !== undefined ? 1 : 0);

  /**
   * R2b, item 4 (revisão do Fable no PR #100, `.fichas-filtro` do desenho): uma ficha por filtro
   * ligado, com o próprio toque removendo só aquele filtro. O desenho esconde esta linha a partir
   * de 1024px (substituída pelas pílulas da barra, que mostram o estado ativo sozinhas); como esta
   * rodada não construiu as pílulas (documentado no PR), as fichas ficam em qualquer largura de
   * tela, único jeito de ver e tirar um filtro sem reabrir a folha "Filtrar".
   */
  const fichasAtivas = [
    ...plataformasExibidas.map((p) => ({
      chave: `plataforma-${p}`,
      rotulo: ROTULO_PLATAFORMA[p],
      aoRemover: () => navegar({ plataformas: plataformasExibidas.filter((v) => v !== p) }),
    })),
    ...formatosExibidos.map((f) => ({
      chave: `formato-${f}`,
      rotulo: ROTULO_FORMATO[f],
      aoRemover: () => navegar({ formatos: formatosExibidos.filter((v) => v !== f) }),
    })),
    ...tiposConteudoExibidos.map((t) => ({
      chave: `tipo-${t}`,
      rotulo: ROTULO_TIPO_CONTEUDO_FILTRAVEL[t],
      aoRemover: () => navegar({ tiposConteudo: tiposConteudoExibidos.filter((v) => v !== t) }),
    })),
    ...(viewsMinExibido !== undefined
      ? [
          {
            chave: "views",
            rotulo: textosReferencias.viewsFaixas.find((f) => f.valor === viewsMinExibido)?.rotulo ?? String(viewsMinExibido),
            aoRemover: () => navegar({ viewsMin: undefined }),
          },
        ]
      : []),
    ...(comFalaExibido !== undefined
      ? [
          {
            chave: "fala",
            rotulo: comFalaExibido ? textosReferencias.comFala : textosReferencias.semFala,
            aoRemover: () => navegar({ comFala: undefined }),
          },
        ]
      : []),
    ...(brasilExibido !== undefined
      ? [
          {
            chave: "brasil",
            rotulo: brasilExibido ? textosReferencias.doBrasil : textosReferencias.deFora,
            aoRemover: () => navegar({ brasil: undefined }),
          },
        ]
      : []),
  ];

  function tirarOsFiltros() {
    navegar({ plataformas: [], formatos: [], ordem: undefined, viewsMin: undefined, comFala: undefined, brasil: undefined, tiposConteudo: [] });
  }

  /**
   * Busca, período, abas e filtros reconsultam o servidor com `router.push`. Sem rede isso não tem `catch`
   * possível: o navegador troca o aplicativo pela página de erro dele e a tela se perde. Por isso, sem rede,
   * só avisa (V7, item 8 do PROXIMO.md); guardar a busca para depois está fora desta etapa.
   *
   * Só `semConexao` (do contexto, valor estável desta renderização), nunca `navigator.onLine` direto
   * (H3, item 0b): `aplicarFiltros` chama esta função e, em seguida, `navegar` chama de novo, e antes as
   * duas liam `navigator.onLine` fresco cada vez, dois pedidos independentes à API do navegador que pode
   * mudar entre um e outro sob carga. Isso corria com `fecharENavegar` fechando a folha de verdade
   * (passava no primeiro pedido) e a navegação em si não acontecendo (falhava no segundo, silenciosamente),
   * exatamente o sintoma visto no CI: a folha fecha, a URL não muda. Com um valor só, estável dentro do
   * mesmo evento, os dois pedidos nunca mais discordam entre si.
   */
  function semRedeParaBuscar(): boolean {
    if (!semConexao) return false;
    mostrarAviso(textosReferencias.semConexaoParaBuscar, "erro");
    return true;
  }

  function navegar(mudanca: Partial<Filtros>, opcoes: { substituir?: boolean } = {}) {
    if (semRedeParaBuscar()) return;
    // O que está escrito na busca vai junto de qualquer outra mudança: a busca só vale com Enter ou ao sair do
    // campo, e a troca de aba ou de período pode chegar antes e apagá-la da URL.
    const filtros: Filtros = {
      segmento,
      periodoDias,
      busca: campoBusca,
      // Otimista, não a prop (F1, item 3, modo B): uma mudança que não mexe em plataforma ou formato
      // (período, busca) não pode reverter um filtro que a pessoa acabou de pedir e ainda não voltou
      // do servidor.
      plataformas: plataformasExibidas,
      formatos: formatosExibidos,
      ordem: ordemExibida,
      viewsMin: viewsMinExibido,
      comFala: comFalaExibido,
      brasil: brasilExibido,
      tiposConteudo: tiposConteudoExibidos,
      // R2b, item 1: qualquer navegação volta para a primeira página de "Todos", menos "Ver mais", que
      // pede a própria quantidade maior explicitamente em `mudanca`.
      quantidade: TAMANHO_PAGINA_TODOS_PADRAO,
      ramo: ramoAtivo,
      ...mudanca,
    };
    const url = montarUrl(filtros);
    // Toque duplo, ou Enter seguido do onBlur, enquanto o mesmo pedido ainda não chegou: um pedido só.
    if (navegando && urlPendente.current === url) return;
    urlPendente.current = url;
    // Uma navegação nova cancela a rede de segurança da anterior (item abaixo): a de agora arma a dela.
    limparRedeDeSeguranca();
    iniciarNavegacao(() => {
      setSegmentoOtimista(filtros.segmento);
      setPeriodoOtimista(filtros.periodoDias);
      setPlataformasOtimista(filtros.plataformas);
      setFormatosOtimista(filtros.formatos);
      setOrdemOtimista(filtros.ordem);
      setViewsMinOtimista(filtros.viewsMin);
      setComFalaOtimista(filtros.comFala);
      setBrasilOtimista(filtros.brasil);
      setTiposConteudoOtimista(filtros.tiposConteudo);
      setQuantidadeOtimista(filtros.quantidade);
      // `substituir` é a folha "Filtrar" fechando: troca a entrada que ela empurrou (useFolhaNoHistorico,
      // `fecharENavegar`), não empurra mais uma. Fora dali, cada filtro pelo topo da tela é a própria
      // navegação da pessoa e continua entrando no histórico como sempre.
      if (opcoes.substituir) router.replace(url);
      else router.push(url);
    });
    /**
     * F1, item 2 (modo A e o achado que apareceu testando o modo B): o `router.replace`/`push` do App
     * Router às vezes busca a página nova (o pedido chega no servidor, a resposta volta 200) e nunca
     * termina de aplicar, sem erro nenhum, sem `navegando` voltar a `false`; reproduzido com freio de
     * CPU e um atraso no `_rsc`, mas não com repetição rápida sem nenhum dos dois, e continua
     * acontecendo com a folha sem disputar o histórico (item 3) e com `fecharENavegar` nunca no mesmo
     * tique (item 2a), então não é esta tela que decide errado, é a navegação que não termina. Sem saber
     * a causa exata dentro do App Router, a rede de segurança: se depois de um tempo generoso a URL
     * ainda não é a que foi pedida (e ninguém pediu outra coisa depois), força uma navegação de
     * verdade. É o último recurso, não o primeiro: só dispara quando o caminho normal já deveria ter
     * terminado.
     *
     * Ajuste A da revisão do PR #71: os dois temporizadores só existem enquanto ESTA navegação continua
     * sendo a última pedida (o efeito que olha as props confirmadas, mais acima, desarma os dois assim
     * que a URL chega) e enquanto a pessoa continua em Referências (`window.location.pathname`, não
     * `url`: é o endereço atual que importa, não o de destino). Sem as duas checagens, sair da tela
     * antes dos 6s, ou os 6s passarem com a navegação já tendo dado certo havia tempo, puxava a pessoa
     * de volta para uma URL que já não fazia sentido mais (achado do Fable, provado contra `next start`).
     */
    avisoDemoraRef.current = setTimeout(() => {
      avisoDemoraRef.current = null;
      if (urlPendente.current === url) setDemorando(true);
    }, 2500);
    redeDeSegurancaRef.current = setTimeout(() => {
      redeDeSegurancaRef.current = null;
      if (urlPendente.current !== url) return;
      if (window.location.pathname !== "/referencias") return;
      const atual = window.location.pathname + window.location.search;
      if (atual === url) return;
      window.location.assign(url);
    }, 6000);
  }

  /**
   * Otimista: o marcador muda na hora; se a gravação falhar, desfaz e diz por quê (V7, item 4 do PROXIMO.md;
   * mesma lição da etapa 12). O aviso de "salvo" só sai depois que o servidor respondeu: antes disso a tela não
   * afirma o que ainda não sabe.
   */
  function alternarFavorito(videoId: number, opcoes: { usarComoReferencia?: boolean } = {}) {
    if (idsPendentes.has(videoId)) return;
    const jaSalvo = favoritos.has(videoId);

    setFavoritos((atual) => {
      const proximo = new Set(atual);
      if (jaSalvo) proximo.delete(videoId);
      else proximo.add(videoId);
      return proximo;
    });
    setIdsPendentes((atual) => new Set(atual).add(videoId));

    iniciarTransicao(async () => {
      try {
        if (jaSalvo) await desfavoritarAction(videoId);
        else await favoritarAction(videoId);
        avisarRedeOk();
        if (!jaSalvo) {
          // "Usar como referência" é a decisão da pessoa: fecha a folha (se ainda for a deste vídeo) e sempre avisa.
          if (opcoes.usarComoReferencia && detalheAtual.current === videoId) detalhes.fechar();
          if (opcoes.usarComoReferencia || !jaMostrouToast.current) {
            jaMostrouToast.current = true;
            mostrarAviso(textosReferencias.toast, "sucesso");
          }
        }
      } catch (erro) {
        setFavoritos((atual) => {
          const proximo = new Set(atual);
          if (jaSalvo) proximo.add(videoId);
          else proximo.delete(videoId);
          return proximo;
        });
        mostrarAviso(tratarFalha(erro, textosReferencias.erroAoSalvar, textosReferencias.erroAoSalvarSemRede), "erro");
      } finally {
        setIdsPendentes((atual) => {
          const proximo = new Set(atual);
          proximo.delete(videoId);
          return proximo;
        });
      }
    });
  }

  function usarComoReferencia() {
    if (videoDetalheId === null) return;
    // Já salvo: não há o que gravar. Fecha a folha e avisa, em vez de deixar um botão que não faz nada.
    if (favoritos.has(videoDetalheId)) {
      detalhes.fechar();
      mostrarAviso(textosReferencias.toast, "sucesso");
      return;
    }
    alternarFavorito(videoDetalheId, { usarComoReferencia: true });
  }

  function aplicarFiltros(filtros: {
    plataformas: Plataforma[];
    formatos: AnaliseVideo["formato"][];
    ordem: OrdemReferencias | undefined;
    viewsMin: number | undefined;
    comFala: boolean | undefined;
    brasil: boolean | undefined;
    tiposConteudo: TipoConteudoFiltravel[];
  }) {
    // Sem rede a folha continua aberta, com o que foi marcado. Um segundo toque antes de a folha sair é
    // ignorado pelo próprio gancho do histórico (`fecharENavegar` é idempotente).
    if (semRedeParaBuscar()) return;
    filtrar.fecharENavegar(() => navegar(filtros, { substituir: true }));
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoTela}>
        <h1>{textosReferencias.titulo}</h1>
        {/* R2b, item 5 (revisão do Fable no PR #100): o subtítulo do "Todos" explica o segmento, não fala em "fora da curva". */}
        <p>{segmento === "todos" ? textosReferencias.linhaTodos : textosReferencias.linha}</p>
      </div>

      <div className={styles.filtros}>
        <div className={styles.segmentado} role="tablist" aria-busy={navegando || undefined}>
          <button
            type="button"
            role="tab"
            aria-selected={segmentoExibido === "foradacurva"}
            className={[styles.segmentoBotao, segmentoExibido === "foradacurva" ? styles.segmentoAtivo : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => navegar({ segmento: "foradacurva", periodoDias: 7 })}
          >
            {textosReferencias.segmentoForaDaCurva}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={segmentoExibido === "todos"}
            className={[styles.segmentoBotao, segmentoExibido === "todos" ? styles.segmentoAtivo : ""].filter(Boolean).join(" ")}
            onClick={() => navegar({ segmento: "todos", periodoDias: 90 })}
          >
            {textosReferencias.segmentoTodos}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={segmentoExibido === "salvos"}
            className={[styles.segmentoBotao, segmentoExibido === "salvos" ? styles.segmentoAtivo : ""].filter(Boolean).join(" ")}
            onClick={() => navegar({ segmento: "salvos", periodoDias: 7 })}
          >
            {textosReferencias.segmentoSalvos}
          </button>
        </div>

        <div className={styles.filtrosLinha}>
          <span className={styles.busca}>
            <Search size={18} strokeWidth={1.5} aria-hidden="true" />
            <input
              placeholder={textosReferencias.buscaPlaceholder}
              value={campoBusca}
              onChange={(evento) => setCampoBusca(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter") navegar({ busca: campoBusca });
              }}
              onBlur={() => {
                if (campoBusca.trim() !== busca) navegar({ busca: campoBusca });
              }}
            />
          </span>
          <select
            className={styles.seletorPeriodo}
            aria-label={textosReferencias.rotuloPeriodo}
            value={periodoExibido}
            onChange={(evento) => navegar({ periodoDias: Number(evento.target.value) })}
          >
            {textosReferencias.periodos.map((p) => (
              <option key={p.dias} value={p.dias}>
                {p.rotulo}
              </option>
            ))}
          </select>
          <Botao
            variante="secundario"
            tamanho="md"
            aria-busy={navegando || undefined}
            // F1, item 3 (modo B): sem isto, a folha podia abrir de novo antes de uma navegação
            // anterior voltar, nascendo com plataformasAtivas/formatosAtivos ainda desatualizados e
            // as duas chamadas de `navegar` ficando em voo ao mesmo tempo (achado do CI).
            disabled={navegando}
            onClick={() => setFolhaFiltrarAberta(true)}
            className={styles.botaoFiltrar}
          >
            <Filter size={16} strokeWidth={1.5} aria-hidden="true" />
            {textosReferencias.filtrar}
            {/* Hotfix (passo 14): a contagem é só o número, nunca mais ", N" com a vírgula solta. */}
            {quantosFiltrosAtivos > 0 ? <span className={styles.quantosAtivos}>{quantosFiltrosAtivos}</span> : null}
          </Botao>

          {/* Passo 14: a partir de 1024px, as seis pílulas à vista substituem o botão "Filtrar" e
              as fichas (escondidos por CSS nessa largura); cada clique já navega, sem "aplicar". */}
          <PilulasFiltroReferencias
            plataformasAtivas={plataformasExibidas}
            formatosAtivos={formatosExibidos}
            periodoDias={periodoExibido}
            viewsMin={viewsMinExibido}
            comFala={comFalaExibido}
            brasil={brasilExibido}
            tiposConteudo={tiposConteudoExibidos}
            contagens={contagensFiltro}
            pilulaAberta={pilulaAberta}
            onAbrir={setPilulaAberta}
            onFechar={() => setPilulaAberta(null)}
            onMudar={(mudanca) => navegar(mudanca)}
          />
          {ramos && ramos.length > 1 ? (
            <PilulaDeRamo
              ramos={ramos}
              ramoAtivo={ramoAtivo}
              pilulaAberta={pilulaAberta}
              onAbrir={setPilulaAberta}
              onFechar={() => setPilulaAberta(null)}
              onEscolher={(ramo) => navegar({ ramo })}
            />
          ) : null}
        </div>

        {fichasAtivas.length > 0 ? (
          <div className={styles.fichas} aria-label="Filtros ligados">
            {fichasAtivas.map((ficha) => (
              <button
                key={ficha.chave}
                type="button"
                className={styles.ficha}
                aria-label={textosReferencias.tirarFiltro(ficha.rotulo)}
                disabled={navegando}
                onClick={ficha.aoRemover}
              >
                {ficha.rotulo}
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            ))}
            <button type="button" className={styles.botaoTirarFiltros} disabled={navegando} onClick={tirarOsFiltros}>
              {textosReferencias.tirarOsFiltros}
            </button>
          </div>
        ) : null}
      </div>

      {redePrincipalSemVideo && segmento !== "salvos" && !navegando ? (
        <p className={styles.avisoRedePrincipal} role="status">
          {textosReferencias.semVideoRedePrincipal(ROTULO_PLATAFORMA[redePrincipalSemVideo])}
        </p>
      ) : null}

      {navegando ? (
        <p className={styles.contagem} role="status">
          {demorando ? textosReferencias.demorandoMaisQueNormal : textosReferencias.buscando}
        </p>
      ) : null}

      {formatados.length === 0 ? (
        segmento === "salvos" ? (
          <div className={styles.blocoVazio}>
            <h3>{textosReferencias.vazioTituloSalvos}</h3>
            <p>{textosReferencias.vazioTextoSalvos}</p>
          </div>
        ) : aindaLendo ? (
          <div className={styles.blocoVazio}>
            <h3>{textosReferencias.aindaLendoTitulo}</h3>
            <p>{textosReferencias.aindaLendoTexto}</p>
          </div>
        ) : (
          <div className={styles.blocoVazio}>
            <h3>{segmento === "todos" ? textosReferencias.vazioTituloTodos : textosReferencias.vazioTitulo}</h3>
            <p>
              {segmento === "todos"
                ? textosReferencias.vazioTextoTodos(periodoDias, juntarPlataformas(plataformasAtivas))
                : textosReferencias.vazioTexto(periodoDias, juntarPlataformas(plataformasAtivas))}
            </p>
            <div className={styles.blocoVazioAcoes}>
              <Botao variante="primario" tamanho="lg" carregando={navegando} onClick={() => navegar({ periodoDias: 30 })}>
                {textosReferencias.ver30Dias}
              </Botao>
              <Botao
                variante="secundario"
                tamanho="lg"
                carregando={navegando}
                onClick={() => {
                  setCampoBusca("");
                  navegar({
                    busca: "",
                    plataformas: [],
                    formatos: [],
                    ordem: undefined,
                    viewsMin: undefined,
                    comFala: undefined,
                    brasil: undefined,
                    tiposConteudo: [],
                  });
                }}
              >
                {textosReferencias.limparFiltros}
              </Botao>
            </div>
          </div>
        )
      ) : (
        <>
          {navegando ? null : (
            <div className={styles.linhaContagem}>
              <p className={styles.contagem}>
                {segmento === "salvos"
                  ? textosReferencias.contagemSalvos(total)
                  : segmento === "todos"
                    ? textosReferencias.contagemTodos(total, periodoDias)
                    : textosReferencias.contagem(total, periodoDias)}
                {/* Passo 14: a partir de 1024px a pílula de Ordem já diz a ordem; o sufixo some (`.ladoContagem` abaixo). */}
                {segmento !== "salvos" ? (
                  <span className={styles.ordemSufixo}>{`, ${textosReferencias.ordemSufixo[ordemExibida ?? "recentes"]}`}</span>
                ) : null}
              </p>
              {segmento !== "salvos" ? (
                <span className={styles.ladoContagem}>
                  {/* Acabamento do PR 1 da E38: no desktop (pílulas, sem fichas), "tirar os filtros" mora
                      aqui ao lado da contagem (`Referencias.ComFiltros.1280`). */}
                  {quantosFiltrosAtivos > 0 ? (
                    <button
                      type="button"
                      className={styles.botaoTirarFiltrosDesktop}
                      disabled={navegando}
                      onClick={tirarOsFiltros}
                    >
                      {textosReferencias.tirarOsFiltros}
                    </button>
                  ) : null}
                  <PilulaOrdem
                    ordem={ordemExibida}
                    pilulaAberta={pilulaAberta}
                    onAbrir={setPilulaAberta}
                    onFechar={() => setPilulaAberta(null)}
                    onMudar={(mudanca) => navegar(mudanca)}
                  />
                </span>
              ) : null}
            </div>
          )}
          <div className={styles.grade}>
            {formatados.map((video) => (
              <ReferenciaCartao
                key={video.id}
                video={video}
                salvo={favoritos.has(video.id)}
                // Sem rede o salvar também fica desabilitado (o cartão não tem o motivo escrito; a faixa do topo explica).
                salvando={idsPendentes.has(video.id)}
                semRede={semConexao}
                onVerDetalhes={() => setVideoDetalheId(video.id)}
                onSalvar={() => alternarFavorito(video.id)}
              />
            ))}
          </div>
          {/* R2b, item 1: "Ver mais" só no "Todos", cresce `quantidade` em vez de paginar por offset (ver TAMANHO_PAGINA_TODOS_PADRAO). */}
          {segmento === "todos" && !navegando && videos.length < total ? (
            <Botao
              variante="secundario"
              tamanho="lg"
              className={styles.botaoVerMais}
              carregando={navegando}
              onClick={() => navegar({ quantidade: quantidadeExibida + TAMANHO_PAGINA_TODOS_PADRAO })}
            >
              {textosReferencias.verMais}
            </Botao>
          ) : null}
        </>
      )}

      <FolhaDetalhesVideo
        video={videoDetalhe}
        url={urlDetalhe}
        aberto={videoDetalheId !== null}
        aoFechar={detalhes.fechar}
        salvo={videoDetalheId !== null && favoritos.has(videoDetalheId)}
        salvando={videoDetalheId !== null && idsPendentes.has(videoDetalheId)}
        onUsarComoReferencia={usarComoReferencia}
        onSalvar={() => {
          if (videoDetalheId !== null) alternarFavorito(videoDetalheId);
        }}
      />

      {/* Só montada com a folha aberta: a cada abertura a seleção nasce da URL, sem sobras de marcas não aplicadas. */}
      {folhaFiltrarAberta ? (
        <FolhaFiltrarReferencias
          aberto
          aoFechar={filtrar.fechar}
          plataformasAtivas={plataformasExibidas}
          formatosAtivos={formatosExibidos}
          ordem={ordemExibida}
          viewsMin={viewsMinExibido}
          comFala={comFalaExibido}
          brasil={brasilExibido}
          tiposConteudo={tiposConteudoExibidos}
          contagens={contagensFiltro}
          totalAtual={total}
          onAplicar={aplicarFiltros}
        />
      ) : null}

      <Toast
        key={aviso?.id ?? 0}
        texto={aviso?.texto ?? ""}
        variante={aviso?.variante}
        aberto={aviso !== null}
        onFechar={fecharAviso}
      />
    </div>
  );
}
