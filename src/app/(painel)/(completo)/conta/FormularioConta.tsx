"use client";

import { useState, type FormEvent } from "react";

import type { TemaPreferido } from "@/db/schema";
import { textosConta } from "@/textos/conta";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Chips } from "@/ui/componentes/Chips";
import { Toast } from "@/ui/componentes/Toast";

import { salvarContaAction } from "./acoes";
import styles from "./page.module.css";

type Props = {
  nomeInicial: string;
  email: string;
  instagramInicial: string;
  tiktokInicial: string;
  youtubeInicial: string;
  temaInicial: TemaPreferido;
  horaLembreteInicial: string;
};

const OPCOES_TEMA = textosConta.temas;
/**
 * Mesma faixa de `salvarPerfilConta` (etapa 13, ajuste 3): o tema do dia
 * nasce as 05:30. Checada aqui tambem porque o navegador nao bloqueia um
 * valor fora do `min`/`max` do campo quando o envio passa pelo `onSubmit`
 * em vez da validacao nativa do formulario (ajuste 4).
 */
const HORA_LEMBRETE_MINIMA = "06:00";
const HORA_LEMBRETE_MAXIMA = "22:00";

/**
 * Mesmo arredondamento de `salvarPerfilConta` (etapa 13, ajuste 4): a faixa
 * acima precisa comparar contra a hora que vai ser gravada de verdade, não
 * contra o valor bruto do campo. Achado da revisão adversarial desta etapa:
 * sem isso, "22:30" (que o servidor aceita, arredondando para "22:00") caía
 * na recusa do cliente antes mesmo de chamar a Server Action.
 */
function arredondarParaHoraCheia(horaMinuto: string): string {
  const [hora] = horaMinuto.split(":");
  return `${hora}:00`;
}

function aplicarTema(tema: TemaPreferido) {
  if (tema === "claro" || tema === "escuro") {
    document.documentElement.setAttribute("data-tema", tema);
  } else {
    document.documentElement.removeAttribute("data-tema");
  }
  try {
    localStorage.setItem("tema", tema);
  } catch {
    // localStorage pode falhar (modo privado); o banco ja e a fonte de verdade.
  }
}

export function FormularioConta({
  nomeInicial,
  email,
  instagramInicial,
  tiktokInicial,
  youtubeInicial,
  temaInicial,
  horaLembreteInicial,
}: Props) {
  const [nome, setNome] = useState(nomeInicial);
  const [instagram, setInstagram] = useState(instagramInicial);
  const [tiktok, setTiktok] = useState(tiktokInicial);
  const [youtube, setYoutube] = useState(youtubeInicial);
  const [tema, setTema] = useState<TemaPreferido>(temaInicial);
  const [horaLembrete, setHoraLembrete] = useState(horaLembreteInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toastAberto, setToastAberto] = useState(false);

  const indiceTema = OPCOES_TEMA.findIndex((opcao) => opcao.valor === tema);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    const horaArredondada = arredondarParaHoraCheia(horaLembrete);
    if (horaArredondada < HORA_LEMBRETE_MINIMA || horaArredondada > HORA_LEMBRETE_MAXIMA) {
      setErro(textosConta.erroHoraForaDaFaixa);
      return;
    }
    setSalvando(true);
    try {
      await salvarContaAction({ nome, perfis: { instagram, tiktok, youtube }, tema, horaLembrete: horaArredondada });
      aplicarTema(tema);
      setToastAberto(true);
    } catch {
      setErro(textosConta.erro);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <form className={styles.forma} onSubmit={salvar}>
        <Campo rotulo={textosConta.nome} value={nome} onChange={(e) => setNome(e.target.value)} required />
        <Campo
          rotulo={`${textosConta.email} ${textosConta.soLeitura}`}
          value={email}
          readOnly
          disabled
        />

        <div className={styles.grupo}>
          <span className={styles.rotuloGrupo}>{textosConta.redes}</span>
          <Campo rotulo="Instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} />
          <Campo rotulo="TikTok" value={tiktok} onChange={(e) => setTiktok(e.target.value)} />
          <Campo rotulo="YouTube" value={youtube} onChange={(e) => setYoutube(e.target.value)} />
        </div>

        <Campo
          type="time"
          step={3600}
          min={HORA_LEMBRETE_MINIMA}
          max={HORA_LEMBRETE_MAXIMA}
          rotulo={textosConta.lembrete}
          value={horaLembrete}
          onChange={(e) => setHoraLembrete(e.target.value)}
        />

        <div className={styles.grupo}>
          <span className={styles.rotuloGrupo}>{textosConta.tema}</span>
          <Chips
            rotuloGrupo={textosConta.tema}
            opcoes={OPCOES_TEMA.map((opcao) => opcao.rotulo)}
            selecionado={indiceTema}
            onChange={(indice) => setTema(OPCOES_TEMA[indice].valor as TemaPreferido)}
          />
        </div>

        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}

        <Botao type="submit" variante="secundario" carregando={salvando} className={styles.botaoSalvar}>
          {salvando ? textosConta.salvando : textosConta.salvar}
        </Botao>
      </form>
      <Toast texto={textosConta.salvo} aberto={toastAberto} onFechar={() => setToastAberto(false)} />
    </>
  );
}
