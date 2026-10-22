"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { conferirSenhaNova } from "@/lib/senha-regras";
import { textosSenha } from "@/textos/senha";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./page.module.css";

const t = textosSenha.redefinir;

export function FormularioRedefinir({ token }: { token: string }) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erroNova, setErroNova] = useState<string | undefined>();
  const [erroRepetida, setErroRepetida] = useState<string | undefined>();
  const [erroForma, setErroForma] = useState<string | null>(null);
  const [linkVencido, setLinkVencido] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [trocada, setTrocada] = useState(false);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (salvando) return;
    setErroNova(undefined);
    setErroRepetida(undefined);
    setErroForma(null);

    const problema = conferirSenhaNova(nova, repetida);
    if (problema === "curta") return void setErroNova(textosSenha.erroCurta);
    if (problema === "longa") return void setErroNova(textosSenha.erroLonga);
    if (problema === "nao_conferem") return void setErroRepetida(textosSenha.erroNaoConferem);

    setSalvando(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: nova, token });
      if (error) {
        // O código gasto ou vencido (400) é o caso comum; o limite de tentativas (429) e a falha do servidor (5xx) têm frase própria.
        if (error.status === 429) setErroForma(t.muitasTentativas);
        else if (error.status >= 500) setErroForma(textosSenha.erroDeServidor);
        else setLinkVencido(true);
        return;
      }
      setTrocada(true);
    } catch (falha) {
      setErroForma(tratarFalha(falha, textosSenha.erroDeServidor, textosSenha.semConexao));
    } finally {
      setSalvando(false);
    }
  }

  if (trocada) {
    return (
      <>
        <p className={styles.confirmacao} role="status">
          {t.feito}
        </p>
        <Botao type="button" tamanho="lg" className={styles.irParaEntrar} onClick={() => router.push("/entrar")}>
          {t.irParaEntrar}
        </Botao>
      </>
    );
  }

  if (linkVencido) {
    return (
      <>
        <p className={styles.erroAviso} role="alert">
          {t.linkInvalidoTexto}
        </p>
        <Link className={styles.linkAcao} href="/entrar?esqueci=1">
          {t.pedirOutro}
        </Link>
      </>
    );
  }

  return (
    <form className={styles.forma} onSubmit={salvar}>
      <Campo
        rotulo={textosSenha.campoNova}
        type="password"
        name="senha-nova"
        autoComplete="new-password"
        required
        ajuda={textosSenha.ajudaMinimo}
        value={nova}
        onChange={(e) => setNova(e.target.value)}
        erro={erroNova}
      />
      <Campo
        rotulo={textosSenha.campoRepetir}
        type="password"
        name="senha-nova-repetida"
        autoComplete="new-password"
        required
        value={repetida}
        onChange={(e) => setRepetida(e.target.value)}
        erro={erroRepetida}
      />
      {erroForma ? (
        <p className={styles.erroAviso} role="alert">
          {erroForma}
        </p>
      ) : null}
      <Botao type="submit" tamanho="lg" carregando={salvando} precisaDeRede>
        {salvando ? t.salvando : t.botao}
      </Botao>
    </form>
  );
}
