"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Cartao } from "@/ui/componentes/Cartao";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { criarEmpresaAction, darAcessoDaEmpresaAction, tirarAcessoDaEmpresaAction } from "./grupo-acoes";
import styles from "./GrupoDaConta.module.css";

/**
 * O bloco "Suas empresas" da Conta (convite de grupo): só aparece para quem criou o acesso por um convite. Mostra "2 de 5" e um campo para criar outra empresa; a nova vira a ativa e a
 * pessoa vai para o `/comecar`.
 */
export function SuasEmpresas({ usadas, maximo }: { usadas: number; maximo: number }) {
  const t = textosConviteDeGrupo.empresas;
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const cheio = usadas >= maximo;

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    if (criando || cheio) return;
    setErro(null);
    setCriando(true);
    try {
      const r = await criarEmpresaAction(nome);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      router.replace("/comecar");
      router.refresh();
    } catch (falha) {
      setErro(tratarFalha(falha, t.erro, t.erro));
    } finally {
      setCriando(false);
    }
  }

  return (
    <Cartao className={styles.bloco} data-teste="suas-empresas">
      <div className={styles.cabeca}>
        <h3 className={styles.titulo}>{t.titulo}</h3>
        <span className={styles.contagem}>{t.contagem(usadas, maximo)}</span>
      </div>
      <p className={styles.explica}>{t.explica}</p>
      {cheio ? (
        <p className={styles.explica}>{t.cheio}</p>
      ) : (
        <form className={styles.forma} onSubmit={criar} noValidate>
          <Campo rotulo={t.campo} name="nova-empresa" placeholder={t.marcador} maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} />
          <Botao type="submit" carregando={criando} precisaDeRede>
            {criando ? t.criando : t.botao}
          </Botao>
        </form>
      )}
      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </Cartao>
  );
}

/** No lugar do "fale com a gente": o dono da empresa do grupo escreve o e-mail e dá acesso. A resposta é a mesma para quem já tinha conta e para quem não tinha. */
export function DarAcessoDaEmpresa() {
  const t = textosConviteDeGrupo.pessoas;
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function dar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setMensagem(null);
    setErro(null);
    setEnviando(true);
    try {
      const r = await darAcessoDaEmpresaAction(email);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setMensagem(r.dado.mensagem);
      setEmail("");
      router.refresh();
    } catch (falha) {
      setErro(tratarFalha(falha, t.erro, t.erro));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className={styles.forma} onSubmit={dar} noValidate data-teste="dar-acesso">
      <Campo rotulo={t.campo} name="email-da-pessoa" type="email" inputMode="email" autoComplete="off" placeholder={t.marcador} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      <Botao type="submit" carregando={enviando} precisaDeRede>
        {enviando ? t.dando : t.dar}
      </Botao>
      {mensagem ? (
        <p className={styles.ok} role="status">
          {mensagem}
        </p>
      ) : null}
      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </form>
  );
}

/** "Tirar acesso" de um membro (nunca aparece para o dono). */
export function TirarAcessoDaEmpresa({ usuarioId }: { usuarioId: string }) {
  const t = textosConviteDeGrupo.pessoas;
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [tirando, setTirando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function tirar() {
    if (tirando) return;
    setErro(null);
    setTirando(true);
    try {
      const r = await tirarAcessoDaEmpresaAction(usuarioId);
      if (!r.ok) setErro(r.erro);
      else router.refresh();
    } catch (falha) {
      setErro(tratarFalha(falha, t.erro, t.erro));
    } finally {
      setTirando(false);
    }
  }

  return (
    <span className={styles.tirar}>
      <Botao type="button" variante="ghost" carregando={tirando} precisaDeRede onClick={tirar}>
        {tirando ? t.tirando : t.tirar}
      </Botao>
      {erro ? (
        <span className={styles.erro} role="alert">
          {erro}
        </span>
      ) : null}
    </span>
  );
}
