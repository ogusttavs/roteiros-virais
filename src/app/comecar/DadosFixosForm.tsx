"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import type { PerfisCliente, Persona, QuemGrava, TipoMarca } from "@/db/schema";
import { montarCampoOnde } from "@/lib/onde";
import { normalizarSite, siteValido } from "@/lib/site-valido";
import { textosBriefing } from "@/textos/briefing";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { BuscaDeRamo } from "@/ui/componentes/BuscaDeRamo";
import { Campo } from "@/ui/componentes/Campo";
import { CampoPerfilRede } from "@/ui/componentes/CampoPerfilRede";
import { Cartao } from "@/ui/componentes/Cartao";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./DadosFixosForm.module.css";

/** `onde` usa os mesmos valores da coluna de "onde estão os clientes" (nota em `config/briefing.ts`, `OndeOpcao`). */
export type DadosFixosIniciais = {
  nome: string;
  onde: "brasil" | "local" | "outro_pais" | "mais_de_um_pais" | null;
  regiao: string | null;
  pais: string | null;
  paises: string | null;
  site: string | null;
  nichoId: number | null;
  /** E45, PR 1: o ramo do catálogo do setor da marca (nulo se o setor foi criado à mão e não está no catálogo). */
  ramoSlug: string | null;
  /** O nome do ramo atual da marca, do catálogo ou do setor feito à mão. */
  ramoNome: string | null;
  ramoOutro: string | null;
  persona: Persona;
  perfis: PerfisCliente | null;
  quemGrava: QuemGrava | null;
};

type Props = {
  inicial: DadosFixosIniciais;
  onSalvar: (dados: unknown) => Promise<void>;
  onVoltar: () => void;
  tipo: TipoMarca;
};

const t = textosBriefing.dadosFixos;

/**
 * O que a pessoa escolheu como ramo (E45, PR 1): um ramo do catálogo; o ramo que a marca já tinha e que não está no catálogo (um setor
 * que o admin criou à mão: continua valendo até ela escolher outro); o "Não achei o meu", com o que ela escreveu; ou nada ainda.
 */
type EscolhaDeRamo =
  | { tipo: "catalogo"; slug: string }
  | { tipo: "atual"; nichoId: number; nome: string }
  | { tipo: "outro" }
  | { tipo: "nenhuma" };

function escolhaInicialDeRamo(inicial: DadosFixosIniciais): EscolhaDeRamo {
  if (inicial.ramoSlug) return { tipo: "catalogo", slug: inicial.ramoSlug };
  if (inicial.nichoId) return { tipo: "atual", nichoId: inicial.nichoId, nome: inicial.ramoNome ?? "" };
  if (inicial.ramoOutro) return { tipo: "outro" };
  return { tipo: "nenhuma" };
}

export function DadosFixosForm({ inicial, onSalvar, onVoltar, tipo }: Props) {
  const dadosFixos = dadosFixosDoBriefing(tipo);
  const personaInicial = dadosFixos.persona.opcoes.some((opcao) => opcao.valor === inicial.persona)
    ? inicial.persona
    : dadosFixos.persona.opcoes[0].valor;

  const [nome, setNome] = useState(inicial.nome);
  const [onde, setOnde] = useState<"brasil" | "local" | "outro_pais" | "mais_de_um_pais" | "">(inicial.onde ?? "");
  const [regiao, setRegiao] = useState(inicial.regiao ?? "");
  const [pais, setPais] = useState(inicial.pais ?? "");
  const [paises, setPaises] = useState(inicial.paises ?? "");
  const [site, setSite] = useState(inicial.site ?? "");
  /**
   * Sem ramo escolhido ainda (cliente novo, sem setor nem texto livre), o campo começa vazio e a pessoa precisa escolher ou escrever
   * antes de continuar: nunca se grava um ramo que ela não escolheu (achado do code review da etapa dos dados fixos, quando o
   * formulário gravava em silêncio o primeiro setor da lista).
   */
  const [escolhaDeRamo, setEscolhaDeRamo] = useState<EscolhaDeRamo>(() => escolhaInicialDeRamo(inicial));
  const [ramoOutro, setRamoOutro] = useState(inicial.ramoOutro ?? "");
  const campoRamoOutroRef = useRef<HTMLInputElement>(null);
  const [pedirFocoNoOutro, setPedirFocoNoOutro] = useState(false);
  const [persona, setPersona] = useState<Persona>(personaInicial);
  const [instagram, setInstagram] = useState(inicial.perfis?.instagram ?? "");
  const [tiktok, setTiktok] = useState(inicial.perfis?.tiktok ?? "");
  const [youtube, setYoutube] = useState(inicial.perfis?.youtube ?? "");
  /** Pessoa (P1, item 2): "quem aparece" e fixo, o campo nem aparece na tela. */
  const [quemGrava, setQuemGrava] = useState<QuemGrava | "">(
    dadosFixos.quemGrava.fixoEmPropriaPessoa ? "propria_pessoa" : (inicial.quemGrava ?? ""),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [tentouEnviar, setTentouEnviar] = useState(false);
  /** Conta as tentativas (e não só "tentou"): o segundo toque no Continuar também leva o foco ao campo que está errado. */
  const [tentativas, setTentativas] = useState(0);
  const formaRef = useRef<HTMLFormElement>(null);
  const tratarFalha = useTratarFalha();
  const erroRef = useRef<HTMLParagraphElement>(null);

  /**
   * O erro fica no fim do formulario, e o "Continuar" e a barra fixa de baixo: quem tocou de cima
   * nao via nada acontecer (V7, item 4 do PROXIMO.md). Rola ate ele.
   */
  useEffect(() => {
    if (erro) erroRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [erro]);

  // Com o formulário inválido, o foco vai ao primeiro campo marcado como errado (o `Campo` não aceita `ref`): rola até ele
  // e quem usa leitor de tela ouve a frase do erro. Antes, o toque em "Continuar" não parecia fazer nada.
  useEffect(() => {
    if (tentativas > 0) formaRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tentativas]);

  // "Não achei o meu" abre o campo do texto livre e leva o foco para ele (já com o que a pessoa tinha digitado na busca).
  useEffect(() => {
    if (pedirFocoNoOutro && escolhaDeRamo.tipo === "outro") {
      campoRamoOutroRef.current?.focus();
      setPedirFocoNoOutro(false);
    }
  }, [pedirFocoNoOutro, escolhaDeRamo]);

  const podeContinuar =
    nome.trim().length > 0 &&
    onde.length > 0 &&
    (onde !== "local" || regiao.trim().length > 0) &&
    (onde !== "outro_pais" || pais.trim().length > 0) &&
    (onde !== "mais_de_um_pais" || paises.trim().length > 0) &&
    (site.trim().length === 0 || siteValido(normalizarSite(site))) &&
    escolhaDeRamo.tipo !== "nenhuma" &&
    (escolhaDeRamo.tipo !== "outro" || ramoOutro.trim().length > 0);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (salvando) return;
    if (!podeContinuar) {
      setTentouEnviar(true);
      setTentativas((n) => n + 1);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar({
        nome,
        // `podeContinuar`, checado acima, já garante `onde` preenchido.
        ...montarCampoOnde(onde as "brasil" | "local" | "outro_pais" | "mais_de_um_pais", regiao.trim(), pais.trim(), paises.trim()),
        site: normalizarSite(site) || undefined,
        ramo: escolhaDeRamo.tipo === "catalogo" ? escolhaDeRamo.slug : undefined,
        nichoId: escolhaDeRamo.tipo === "atual" ? escolhaDeRamo.nichoId : undefined,
        ramoOutro: escolhaDeRamo.tipo === "outro" ? ramoOutro : undefined,
        persona,
        perfis: {
          instagram: instagram.trim() || undefined,
          tiktok: tiktok.trim() || undefined,
          youtube: youtube.trim() || undefined,
        },
        quemGrava: quemGrava || undefined,
      });
    } catch (falha) {
      // Falha de rede nao e campo errado: a frase diz que foi a rede e que o digitado continua aqui.
      setErro(tratarFalha(falha, t.erro));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form ref={formaRef} className={styles.forma} onSubmit={enviar}>
      <Cartao className={styles.dois}>
        <Campo rotulo={dadosFixos.nome.rotulo} value={nome} onChange={(evento) => setNome(evento.target.value)} />
        <div className={styles.campoRamo}>
          <BuscaDeRamo
            rotulo={dadosFixos.ramo.rotulo}
            ajuda={dadosFixos.ramo.ajuda}
            valor={escolhaDeRamo.tipo === "catalogo" ? escolhaDeRamo.slug : null}
            nomeForaDoCatalogo={
              escolhaDeRamo.tipo === "atual" ? escolhaDeRamo.nome : escolhaDeRamo.tipo === "outro" ? dadosFixos.ramo.opcaoOutro : null
            }
            textoNaoAchei={dadosFixos.ramo.opcaoOutro}
            erro={tentouEnviar && escolhaDeRamo.tipo === "nenhuma" ? t.ramoNaoEscolhido : undefined}
            onEscolher={(slug) => setEscolhaDeRamo({ tipo: "catalogo", slug })}
            onNaoAchei={(digitado) => {
              // O que a pessoa tinha digitado vira o começo do texto livre; se ela já tinha escrito um, o dela fica.
              if (digitado) setRamoOutro((atual) => (atual.trim() ? atual : digitado));
              setEscolhaDeRamo({ tipo: "outro" });
              setPedirFocoNoOutro(true);
            }}
          />
        </div>
        {escolhaDeRamo.tipo === "outro" ? (
          <Campo
            ref={campoRamoOutroRef}
            rotulo={t.campoRamoOutro}
            ajuda={t.ajudaRamoOutro}
            value={ramoOutro}
            onChange={(evento) => setRamoOutro(evento.target.value)}
            erro={tentouEnviar && ramoOutro.trim().length === 0 ? t.ramoObrigatorio : undefined}
          />
        ) : null}
        <Campo
          rotulo={dadosFixos.site.rotulo}
          ajuda={dadosFixos.site.ajuda}
          value={site}
          onChange={(evento) => setSite(evento.target.value)}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          erro={tentouEnviar && site.trim().length > 0 && !siteValido(normalizarSite(site)) ? t.siteInvalido : undefined}
        />
      </Cartao>

      <Cartao className={styles.grupo}>
        <div>
          <h3 className={styles.tituloGrupo}>{dadosFixos.onde.rotulo}</h3>
        </div>
        <div className={styles.opcoes} role="radiogroup" aria-label={dadosFixos.onde.rotulo}>
          {dadosFixos.onde.opcoes.map((opcao) => (
            <OpcaoObjetivo
              key={opcao.valor}
              titulo={opcao.rotulo}
              marcada={onde === opcao.valor}
              onEscolher={() => setOnde(opcao.valor)}
            />
          ))}
        </div>
        {onde === "local" ? (
          <Campo
            rotulo={dadosFixos.onde.campoRegiao.rotulo}
            ajuda={dadosFixos.onde.campoRegiao.ajuda}
            value={regiao}
            onChange={(evento) => setRegiao(evento.target.value)}
            erro={tentouEnviar && regiao.trim().length === 0 ? t.regiaoObrigatoria : undefined}
          />
        ) : null}
        {onde === "outro_pais" ? (
          <Campo
            rotulo={dadosFixos.onde.campoPais.rotulo}
            ajuda={dadosFixos.onde.campoPais.ajuda}
            value={pais}
            onChange={(evento) => setPais(evento.target.value)}
            erro={tentouEnviar && pais.trim().length === 0 ? t.paisObrigatorio : undefined}
          />
        ) : null}
        {onde === "mais_de_um_pais" ? (
          <Campo
            rotulo={dadosFixos.onde.campoPaises.rotulo}
            ajuda={dadosFixos.onde.campoPaises.ajuda}
            value={paises}
            onChange={(evento) => setPaises(evento.target.value)}
            erro={tentouEnviar && paises.trim().length === 0 ? t.paisesObrigatorio : undefined}
          />
        ) : null}
        {onde === "outro_pais" || onde === "mais_de_um_pais" ? (
          <p className={styles.ajudaGrupo}>{dadosFixos.onde.avisoPesquisaNoBrasil}</p>
        ) : null}
      </Cartao>

      <Cartao className={styles.grupo}>
        <div>
          <h3 className={styles.tituloGrupo}>{t.tituloObjetivo}</h3>
          <p className={styles.ajudaGrupo}>{t.ajudaObjetivo}</p>
        </div>
        <div className={styles.opcoes} role="radiogroup" aria-label={dadosFixos.persona.rotulo}>
          {dadosFixos.persona.opcoes.map((opcao) => (
            <OpcaoObjetivo
              key={opcao.valor}
              titulo={opcao.rotulo}
              marcada={persona === opcao.valor}
              onEscolher={() => setPersona(opcao.valor)}
            />
          ))}
        </div>
      </Cartao>

      {dadosFixos.quemGrava.fixoEmPropriaPessoa ? null : (
        <Cartao className={styles.grupo}>
          <div>
            <h3 className={styles.tituloGrupo}>{dadosFixos.quemGrava.rotulo}</h3>
            <p className={styles.ajudaGrupo}>{dadosFixos.quemGrava.ajuda}</p>
          </div>
          <div className={styles.opcoes} role="radiogroup" aria-label={dadosFixos.quemGrava.rotulo}>
            {dadosFixos.quemGrava.opcoes.map((opcao) => (
              <OpcaoObjetivo
                key={opcao.valor}
                titulo={opcao.rotulo}
                marcada={quemGrava === opcao.valor}
                onEscolher={() => setQuemGrava(opcao.valor)}
              />
            ))}
          </div>
        </Cartao>
      )}

      <Cartao className={styles.grupo}>
        <h3 className={styles.tituloGrupo}>{t.tituloRedes}</h3>
        <CampoPerfilRede
          plataforma="instagram"
          rotulo={t.campoInstagram}
          valor={instagram}
          onMudar={setInstagram}
          avisoInvalido={t.perfilInvalido}
        />
        <CampoPerfilRede
          plataforma="tiktok"
          rotulo={t.campoTiktok}
          valor={tiktok}
          onMudar={setTiktok}
          avisoInvalido={t.perfilInvalido}
        />
        <CampoPerfilRede
          plataforma="youtube"
          rotulo={t.campoYoutube}
          valor={youtube}
          onMudar={setYoutube}
          avisoInvalido={t.perfilInvalido}
        />
      </Cartao>

      {erro ? (
        <p ref={erroRef} className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      <BarraAcao
        presaAoFluxo
        secundaria={{ rotulo: textosBriefing.navegacaoBlocos.botaoVoltar, onClick: onVoltar }}
        primaria={{
          rotulo: salvando ? t.salvando : t.botaoContinuar,
          type: "submit",
          disabled: salvando,
        }}
      />
    </form>
  );
}
