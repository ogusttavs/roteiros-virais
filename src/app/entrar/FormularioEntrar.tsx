"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { textosEntrar } from "@/textos/entrar";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import styles from "./page.module.css";

export function FormularioEntrar() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [mandandoLink, setMandandoLink] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [linkEnviadoPara, setLinkEnviadoPara] = useState<string | null>(null);

  async function entrarComSenha(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEntrando(true);

    const { error } = await authClient.signIn.email({ email, password: senha });

    setEntrando(false);
    if (error) {
      setErro(textosEntrar.erroGenerico);
      return;
    }
    router.push("/hoje");
    router.refresh();
  }

  async function entrarSemSenha() {
    if (!email) {
      setErro(textosEntrar.erroSemEmail);
      return;
    }
    setErro(null);
    setMandandoLink(true);

    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/hoje" });

    setMandandoLink(false);
    if (error) {
      setErro(textosEntrar.erroGenerico);
      return;
    }
    setLinkEnviadoPara(email);
  }

  if (linkEnviadoPara) {
    return <p className={styles.confirmacao}>{textosEntrar.linkEnviado(linkEnviadoPara)}</p>;
  }

  return (
    <>
      <form className={styles.forma} onSubmit={entrarComSenha}>
        <Campo
          rotulo={textosEntrar.campoEmail}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
        <Campo
          rotulo={textosEntrar.campoSenha}
          type="password"
          name="senha"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
        />
        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}
        <Botao type="submit" tamanho="lg" carregando={entrando}>
          {entrando ? textosEntrar.entrando : textosEntrar.botaoEntrar}
        </Botao>
      </form>
      <p className={styles.separador}>
        <button type="button" className={styles.linkSemSenha} onClick={entrarSemSenha}>
          {mandandoLink ? textosEntrar.mandandoLink : textosEntrar.linkSemSenha}
        </button>
      </p>
    </>
  );
}
