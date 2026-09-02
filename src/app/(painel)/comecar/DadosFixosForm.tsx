"use client";

import { useState, type FormEvent } from "react";

import { DADOS_FIXOS } from "@/config/briefing";
import type { PerfisCliente, Persona, QuemGrava } from "@/db/schema";
import { textosBriefing } from "@/textos/briefing";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

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
};

const t = textosBriefing.dadosFixos;
const OUTRO = "outro" as const;

export function DadosFixosForm({ nichos, inicial, onSalvar }: Props) {
  const [nome, setNome] = useState(inicial.nome);
  const [cidade, setCidade] = useState(inicial.cidade ?? "");
  const [bairro, setBairro] = useState(inicial.bairro ?? "");
  const [nichoId, setNichoId] = useState<number | typeof OUTRO>(
    inicial.nichoId ?? (inicial.ramoOutro ? OUTRO : (nichos[0]?.id ?? OUTRO)),
  );
  const [ramoOutro, setRamoOutro] = useState(inicial.ramoOutro ?? "");
  const [persona, setPersona] = useState<Persona>(inicial.persona);
  const [instagram, setInstagram] = useState(inicial.perfis?.instagram ?? "");
  const [tiktok, setTiktok] = useState(inicial.perfis?.tiktok ?? "");
  const [youtube, setYoutube] = useState(inicial.perfis?.youtube ?? "");
  const [quemGrava, setQuemGrava] = useState<QuemGrava | "">(inicial.quemGrava ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeContinuar =
    nome.trim().length > 0 &&
    cidade.trim().length > 0 &&
    (nichoId !== OUTRO || ramoOutro.trim().length > 0);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!podeContinuar) return;
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
        required
      />
      <Campo
        rotulo={DADOS_FIXOS.cidade.rotulo}
        value={cidade}
        onChange={(evento) => setCidade(evento.target.value)}
        required
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
          required
        />
      ) : null}

      <fieldset className={styles.grupoOpcoes}>
        <legend className={styles.rotulo}>{DADOS_FIXOS.persona.rotulo}</legend>
        {DADOS_FIXOS.persona.opcoes.map((opcao) => (
          <label key={opcao.valor} className={styles.opcao}>
            <input
              type="radio"
              name="persona"
              value={opcao.valor}
              checked={persona === opcao.valor}
              onChange={() => setPersona(opcao.valor)}
            />
            {opcao.rotulo}
          </label>
        ))}
      </fieldset>

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

      <fieldset className={styles.grupoOpcoes}>
        <legend className={styles.rotulo}>{DADOS_FIXOS.quemGrava.rotulo}</legend>
        {DADOS_FIXOS.quemGrava.opcoes.map((opcao) => (
          <label key={opcao.valor} className={styles.opcao}>
            <input
              type="radio"
              name="quemGrava"
              value={opcao.valor}
              checked={quemGrava === opcao.valor}
              onChange={() => setQuemGrava(opcao.valor)}
            />
            {opcao.rotulo}
          </label>
        ))}
      </fieldset>

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}

      <Botao type="submit" tamanho="lg" carregando={salvando} disabled={!podeContinuar}>
        {salvando ? t.salvando : t.botaoContinuar}
      </Botao>
    </form>
  );
}
