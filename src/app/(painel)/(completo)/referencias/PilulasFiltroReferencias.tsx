"use client";

import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { FORMATOS_EM_ORDEM, ROTULO_FORMATO, ROTULO_TIPO_CONTEUDO_FILTRAVEL, TIPOS_CONTEUDO_FILTRAVEIS_EM_ORDEM } from "@/ia/enums";
import type { ContagensFiltroReferencias, OrdemReferencias, TipoConteudoFiltravel } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";

import { ItemMenuCheckbox, ItemMenuRadio, PilulaFiltro } from "./PilulaFiltro";
import styles from "./PilulasFiltroReferencias.module.css";

const PLATAFORMAS_EM_ORDEM: { valor: Plataforma; rotulo: string }[] = [
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "youtube", rotulo: "YouTube" },
];

const ORDENS_EM_ORDEM: { valor: OrdemReferencias; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "views", rotulo: "Mais views" },
  { valor: "multiplo", rotulo: "Mais vezes acima do normal da conta" },
  { valor: "velocidade", rotulo: "Mais views por hora" },
];

const CONTAGEM_PERIODO: Record<number, keyof ContagensFiltroReferencias["porPeriodo"]> = { 7: "sete", 30: "trinta", 90: "noventa" };

type MudancaFiltro = Partial<{
  plataformas: Plataforma[];
  formatos: AnaliseVideo["formato"][];
  periodoDias: number;
  ordem: OrdemReferencias | undefined;
  viewsMin: number | undefined;
  comFala: boolean | undefined;
  brasil: boolean | undefined;
  tiposConteudo: TipoConteudoFiltravel[];
}>;

/** "Fala" e "De onde" não têm opção "os dois" própria: marcar de novo o que já estava marcado desmarca. */
function alternarUnico<T>(atual: T | undefined, valor: T): T | undefined {
  return atual === valor ? undefined : valor;
}

/** "TikTok", "TikTok e Instagram", ou "Rede (N)" com três ou mais (o desenho só mostra o caso de uma rede marcada). */
function rotuloContagem(rotuloBase: string, marcados: string[]): string {
  if (marcados.length === 0) return rotuloBase;
  if (marcados.length <= 2) return marcados.join(" e ");
  return `${rotuloBase} (${marcados.length})`;
}

type PropsComuns = {
  plataformasAtivas: Plataforma[];
  formatosAtivos: AnaliseVideo["formato"][];
  periodoDias: number;
  viewsMin: number | undefined;
  comFala: boolean | undefined;
  brasil: boolean | undefined;
  tiposConteudo: TipoConteudoFiltravel[];
  contagens: ContagensFiltroReferencias;
  pilulaAberta: string | null;
  onAbrir: (id: string) => void;
  onFechar: () => void;
  onMudar: (mudanca: MudancaFiltro) => void;
};

/**
 * As seis pílulas de filtro à vista, do tablet deitado para cima (passo 14, `.pilulas-filtro`,
 * mesmo estado que a folha "Filtrar" do celular, só que cada clique já navega na hora, sem um
 * passo de "aplicar": é um menu, não um formulário). A pílula de "Ordem" mora em outro lugar da
 * tela (`PilulaOrdem`, ao lado da contagem, como o desenho pede), mas reparte o mesmo
 * `pilulaAberta` de quem chama, para só uma ficar aberta por vez.
 */
export function PilulasFiltroReferencias({
  plataformasAtivas,
  formatosAtivos,
  periodoDias,
  viewsMin,
  comFala,
  brasil,
  tiposConteudo,
  contagens,
  pilulaAberta,
  onAbrir,
  onFechar,
  onMudar,
}: PropsComuns) {
  const nomesRede = plataformasAtivas.map((p) => PLATAFORMAS_EM_ORDEM.find((o) => o.valor === p)?.rotulo ?? p);
  const nomesTipo = [
    ...formatosAtivos.map((f) => ROTULO_FORMATO[f]),
    ...tiposConteudo.map((t) => ROTULO_TIPO_CONTEUDO_FILTRAVEL[t]),
  ];

  return (
    <div className={styles.pilulas} role="group" aria-label={textosReferencias.ordemEFiltros}>
      <PilulaFiltro
        id="views"
        rotulo={viewsMin === undefined ? textosReferencias.views : (textosReferencias.viewsFaixas.find((f) => f.valor === viewsMin)?.rotulo ?? textosReferencias.views)}
        ativa={viewsMin !== undefined}
        menuRotulo={textosReferencias.views}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        <ItemMenuRadio
          rotulo={textosReferencias.qualquerNumeroDeViews}
          quantos={contagens.porViewsMin.qualquer}
          marcado={viewsMin === undefined}
          onClick={() => onMudar({ viewsMin: undefined })}
        />
        {textosReferencias.viewsFaixas.map((f) => (
          <ItemMenuRadio
            key={f.valor}
            rotulo={f.rotulo}
            quantos={
              f.valor === 10_000
                ? contagens.porViewsMin.dezMil
                : f.valor === 50_000
                  ? contagens.porViewsMin.cinquentaMil
                  : f.valor === 100_000
                    ? contagens.porViewsMin.cemMil
                    : contagens.porViewsMin.umMilhao
            }
            marcado={viewsMin === f.valor}
            onClick={() => onMudar({ viewsMin: f.valor })}
          />
        ))}
      </PilulaFiltro>

      <PilulaFiltro
        id="rede"
        rotulo={rotuloContagem(textosReferencias.rede, nomesRede)}
        ativa={plataformasAtivas.length > 0}
        menuRotulo={textosReferencias.ondeFoiPostado}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        {PLATAFORMAS_EM_ORDEM.map((p) => (
          <ItemMenuCheckbox
            key={p.valor}
            rotulo={p.rotulo}
            quantos={contagens.porPlataforma[p.valor]}
            marcado={plataformasAtivas.includes(p.valor)}
            onClick={() =>
              onMudar({ plataformas: plataformasAtivas.includes(p.valor) ? plataformasAtivas.filter((v) => v !== p.valor) : [...plataformasAtivas, p.valor] })
            }
          />
        ))}
      </PilulaFiltro>

      <PilulaFiltro
        id="periodo"
        rotulo={`${textosReferencias.rotuloPeriodo}: ${textosReferencias.periodos.find((p) => p.dias === periodoDias)?.rotulo ?? periodoDias}`}
        ativa={false}
        menuRotulo={textosReferencias.rotuloPeriodo}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        {textosReferencias.periodos.map((p) => (
          <ItemMenuRadio
            key={p.dias}
            rotulo={p.rotulo}
            quantos={contagens.porPeriodo[CONTAGEM_PERIODO[p.dias]]}
            marcado={periodoDias === p.dias}
            onClick={() => onMudar({ periodoDias: p.dias })}
          />
        ))}
      </PilulaFiltro>

      <PilulaFiltro
        id="tipo"
        rotulo={rotuloContagem(textosReferencias.tipoDeVideo, nomesTipo)}
        ativa={formatosAtivos.length + tiposConteudo.length > 0}
        menuRotulo={textosReferencias.tipoDeVideo}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        {FORMATOS_EM_ORDEM.map((f) => (
          <ItemMenuCheckbox
            key={f}
            rotulo={ROTULO_FORMATO[f]}
            quantos={contagens.porFormato[f]}
            marcado={formatosAtivos.includes(f)}
            onClick={() => onMudar({ formatos: formatosAtivos.includes(f) ? formatosAtivos.filter((v) => v !== f) : [...formatosAtivos, f] })}
          />
        ))}
        {TIPOS_CONTEUDO_FILTRAVEIS_EM_ORDEM.map((t) => (
          <ItemMenuCheckbox
            key={t}
            rotulo={ROTULO_TIPO_CONTEUDO_FILTRAVEL[t]}
            quantos={contagens.porTipoConteudo[t]}
            marcado={tiposConteudo.includes(t)}
            onClick={() => onMudar({ tiposConteudo: tiposConteudo.includes(t) ? tiposConteudo.filter((v) => v !== t) : [...tiposConteudo, t] })}
          />
        ))}
      </PilulaFiltro>

      <PilulaFiltro
        id="fala"
        rotulo={comFala === undefined ? textosReferencias.comOuSemFala : comFala ? textosReferencias.comFala : textosReferencias.semFala}
        ativa={comFala !== undefined}
        menuRotulo={textosReferencias.fala}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        <ItemMenuRadio
          rotulo={textosReferencias.comFala}
          quantos={contagens.porFala.comFala}
          marcado={comFala === true}
          onClick={() => onMudar({ comFala: alternarUnico(comFala, true) })}
        />
        <ItemMenuRadio
          rotulo={textosReferencias.semFala}
          quantos={contagens.porFala.semFala}
          marcado={comFala === false}
          onClick={() => onMudar({ comFala: alternarUnico(comFala, false) })}
        />
      </PilulaFiltro>

      <PilulaFiltro
        id="brasil"
        rotulo={brasil === undefined ? textosReferencias.brasilOuFora : brasil ? textosReferencias.doBrasil : textosReferencias.deFora}
        ativa={brasil !== undefined}
        menuRotulo={textosReferencias.deOnde}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        <ItemMenuRadio
          rotulo={textosReferencias.doBrasil}
          quantos={contagens.porBrasil.brasil}
          marcado={brasil === true}
          onClick={() => onMudar({ brasil: alternarUnico(brasil, true) })}
        />
        <ItemMenuRadio
          rotulo={textosReferencias.deFora}
          quantos={contagens.porBrasil.fora}
          marcado={brasil === false}
          onClick={() => onMudar({ brasil: alternarUnico(brasil, false) })}
        />
      </PilulaFiltro>
    </div>
  );
}

type PropsOrdem = {
  ordem: OrdemReferencias | undefined;
  pilulaAberta: string | null;
  onAbrir: (id: string) => void;
  onFechar: () => void;
  onMudar: (mudanca: MudancaFiltro) => void;
};

/** A pílula de "Ordem" (não é um filtro, não reduz quantos vídeos aparecem; por isso mora ao
 * lado da contagem, não no grupo das outras seis, como o desenho pede). */
export function PilulaOrdem({ ordem, pilulaAberta, onAbrir, onFechar, onMudar }: PropsOrdem) {
  const atual = ordem ?? "recentes";
  return (
    <PilulaFiltro
      id="ordem"
      rotulo={`${textosReferencias.emQueOrdem}: ${(ORDENS_EM_ORDEM.find((o) => o.valor === atual)?.rotulo ?? "").toLowerCase()}`}
      ativa={false}
      menuRotulo={textosReferencias.emQueOrdem}
      pilulaAberta={pilulaAberta}
      onAbrir={onAbrir}
      onFechar={onFechar}
    >
      {ORDENS_EM_ORDEM.map((o) => (
        <ItemMenuRadio
          key={o.valor}
          rotulo={o.rotulo}
          marcado={atual === o.valor}
          onClick={() => onMudar({ ordem: o.valor === "recentes" ? undefined : o.valor })}
        />
      ))}
    </PilulaFiltro>
  );
}
