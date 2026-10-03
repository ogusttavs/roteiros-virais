"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import type { PerfisCliente, Persona, QuemGrava, TipoMarca } from "@/db/schema";
import { montarCampoOnde } from "@/lib/onde";
import { normalizarSite, siteValido } from "@/lib/site-valido";
import { textosBriefing } from "@/textos/briefing";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
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
  ramoOutro: string | null;
  persona: Persona;
  perfis: PerfisCliente | null;
  quemGrava: QuemGrava | null;
};

type Props = {
  nichos: { id: number; nome: string }[];
  inicial: DadosFixosIniciais;
  onSalvar: (dados: unknown) => Promise<void>;
  onVoltar: () => void;
  tipo: TipoMarca;
};

const t = textosBriefing.dadosFixos;
const OUTRO = "outro" as const;

export function DadosFixosForm({ nichos, inicial, onSalvar, onVoltar, tipo }: Props) {
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
   * Sem ramo escolhido ainda (cliente novo, sem nichoId nem ramoOutro), o
   * select comeca em "outro" em vez do primeiro nicho da lista (achado no
   * code review desta rodada): a pessoa tinha como continuar sem nunca
   * tocar no campo, e o formulario gravava silenciosamente o primeiro nicho
   * da lista como se fosse a escolha dela. Em "outro", precisa digitar
   * alguma coisa (ou trocar para um nicho de verdade) antes de continuar.
   */
  const [nichoId, setNichoId] = useState<number | typeof OUTRO>(
    inicial.nichoId ?? OUTRO,
  );
  const [ramoOutro, setRamoOutro] = useState(inicial.ramoOutro ?? "");
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
  const tratarFalha = useTratarFalha();
  const erroRef = useRef<HTMLParagraphElement>(null);

  /**
   * O erro fica no fim do formulario, e o "Continuar" e a barra fixa de baixo: quem tocou de cima
   * nao via nada acontecer (V7, item 4 do PROXIMO.md). Rola ate ele.
   */
  useEffect(() => {
    if (erro) erroRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [erro]);

  const podeContinuar =
    nome.trim().length > 0 &&
    onde.length > 0 &&
    (onde !== "local" || regiao.trim().length > 0) &&
    (onde !== "outro_pais" || pais.trim().length > 0) &&
    (onde !== "mais_de_um_pais" || paises.trim().length > 0) &&
    (site.trim().length === 0 || siteValido(normalizarSite(site))) &&
    (nichoId !== OUTRO || ramoOutro.trim().length > 0);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (salvando) return;
    if (!podeContinuar) {
      setTentouEnviar(true);
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
        nichoId: nichoId === OUTRO ? undefined : nichoId,
        ramoOutro: nichoId === OUTRO ? ramoOutro : undefined,
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
    <form className={styles.forma} onSubmit={enviar}>
      <Cartao className={styles.dois}>
        <Campo rotulo={dadosFixos.nome.rotulo} value={nome} onChange={(evento) => setNome(evento.target.value)} />
        <label className={styles.campoSelect} htmlFor="ramo">
          {dadosFixos.ramo.rotulo}
          <span className={styles.ajuda}>{dadosFixos.ramo.ajuda}</span>
          <select
            id="ramo"
            className={styles.select}
            value={nichoId}
            onChange={(evento) =>
              setNichoId(evento.target.value === OUTRO ? OUTRO : Number(evento.target.value))
            }
          >
            {nichos.map((nicho) => (
              <option key={nicho.id} value={nicho.id}>
                {nicho.nome}
              </option>
            ))}
            <option value={OUTRO}>{dadosFixos.ramo.opcaoOutro}</option>
          </select>
        </label>
        {nichoId === OUTRO ? (
          <Campo
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
