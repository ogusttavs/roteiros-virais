"use client";

import { useState, type FormEvent } from "react";

import { DADOS_FIXOS } from "@/config/briefing";
import type { PerfisCliente, Persona, QuemGrava } from "@/db/schema";
import { textosBriefing } from "@/textos/briefing";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { Campo } from "@/ui/componentes/Campo";
import { Chips } from "@/ui/componentes/Chips";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";

import styles from "./DadosFixosForm.module.css";

export type DadosFixosIniciais = {
  nome: string;
  cidade: string | null;
  bairro: string | null;
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
};

const t = textosBriefing.dadosFixos;
const OUTRO = "outro" as const;
const OPCOES_QUEM_GRAVA = DADOS_FIXOS.quemGrava.opcoes.map((opcao) => opcao.rotulo);

export function DadosFixosForm({ nichos, inicial, onSalvar, onVoltar }: Props) {
  const [nome, setNome] = useState(inicial.nome);
  const [cidade, setCidade] = useState(inicial.cidade ?? "");
  const [bairro, setBairro] = useState(inicial.bairro ?? "");
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
  const [persona, setPersona] = useState<Persona>(inicial.persona);
  const [instagram, setInstagram] = useState(inicial.perfis?.instagram ?? "");
  const [tiktok, setTiktok] = useState(inicial.perfis?.tiktok ?? "");
  const [youtube, setYoutube] = useState(inicial.perfis?.youtube ?? "");
  const [quemGrava, setQuemGrava] = useState<QuemGrava | "">(inicial.quemGrava ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [tentouEnviar, setTentouEnviar] = useState(false);

  const podeContinuar =
    nome.trim().length > 0 &&
    cidade.trim().length > 0 &&
    (nichoId !== OUTRO || ramoOutro.trim().length > 0);

  const indiceQuemGrava = DADOS_FIXOS.quemGrava.opcoes.findIndex((opcao) => opcao.valor === quemGrava);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!podeContinuar) {
      setTentouEnviar(true);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar({
        nome,
        cidade,
        bairro: bairro.trim() || undefined,
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
    } catch {
      setErro(t.erro);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className={styles.forma} onSubmit={enviar}>
      <Campo
        rotulo={DADOS_FIXOS.nome.rotulo}
        value={nome}
        onChange={(evento) => setNome(evento.target.value)}
      />
      <Campo
        rotulo={DADOS_FIXOS.cidade.rotulo}
        value={cidade}
        onChange={(evento) => setCidade(evento.target.value)}
        erro={tentouEnviar && cidade.trim().length === 0 ? t.cidadeObrigatoria : undefined}
      />
      <Campo
        rotulo={DADOS_FIXOS.bairro.rotulo}
        value={bairro}
        onChange={(evento) => setBairro(evento.target.value)}
      />

      <label className={styles.rotulo} htmlFor="ramo">
        {DADOS_FIXOS.ramo.rotulo}
        <span className={styles.ajuda}>{DADOS_FIXOS.ramo.ajuda}</span>
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
          <option value={OUTRO}>{DADOS_FIXOS.ramo.opcaoOutro}</option>
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

      <div className={styles.grupoOpcoes} role="radiogroup" aria-label={DADOS_FIXOS.persona.rotulo}>
        <span className={styles.rotuloGrupo}>{DADOS_FIXOS.persona.rotulo}</span>
        {DADOS_FIXOS.persona.opcoes.map((opcao) => (
          <OpcaoObjetivo
            key={opcao.valor}
            titulo={opcao.rotulo}
            marcada={persona === opcao.valor}
            onEscolher={() => setPersona(opcao.valor)}
          />
        ))}
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{t.tituloRedes}</span>
        <Campo
          rotulo={t.campoInstagram}
          value={instagram}
          onChange={(evento) => setInstagram(evento.target.value)}
        />
        <Campo rotulo={t.campoTiktok} value={tiktok} onChange={(evento) => setTiktok(evento.target.value)} />
        <Campo
          rotulo={t.campoYoutube}
          value={youtube}
          onChange={(evento) => setYoutube(evento.target.value)}
        />
      </div>

      <div className={styles.grupo}>
        <span className={styles.rotuloGrupo}>{DADOS_FIXOS.quemGrava.rotulo}</span>
        <Chips
          rotuloGrupo={DADOS_FIXOS.quemGrava.rotulo}
          opcoes={OPCOES_QUEM_GRAVA}
          selecionado={indiceQuemGrava === -1 ? null : indiceQuemGrava}
          onChange={(indice) => setQuemGrava(DADOS_FIXOS.quemGrava.opcoes[indice].valor)}
        />
      </div>

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      <BarraAcao
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
