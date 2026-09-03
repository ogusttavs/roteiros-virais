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
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [linkEnviadoPara, setLinkEnviadoPara] = useState<string | null>(null);

  async function entrarComSenha(evento: FormEvent) {
    evento.preventDefault();
    setErroSenha(null);
    setErroEmail(null);
    setEntrando(true);

    const { data, error } = await authClient.signIn.email({ email, password: senha });

    setEntrando(false);
    if (error || !data) {
      setErroSenha(textosEntrar.erroGenerico);
      return;
    }
    router.push(data.user.role === "admin" ? "/admin/clientes" : "/hoje");
    router.refresh();
  }

  async function entrarSemSenha() {
    if (!email) {
      setErroEmail(textosEntrar.erroSemEmail);
      return;
    }
    setErroEmail(null);
    setErroSenha(null);
    setMandandoLink(true);

    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/hoje" });

    setMandandoLink(false);
    if (error) {
      setErroSenha(textosEntrar.erroGenerico);
      return;
    }
    setLinkEnviadoPara(email);
  }

  if (linkEnviadoPara) {
    return (
      <>
        <p className={styles.confirmacao}>{textosEntrar.linkEnviado(linkEnviadoPara)}</p>
        <button type="button" className={styles.linkAcao} onClick={() => void entrarSemSenha()}>
          {mandandoLink ? textosEntrar.mandandoLink : textosEntrar.mandarDeNovo}
        </button>
      </>
    );
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
          erro={erroEmail ?? undefined}
        />
        <Campo
          rotulo={textosEntrar.campoSenha}
          type="password"
          name="senha"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          erro={erroSenha ?? undefined}
        />
        <Botao type="submit" tamanho="lg" carregando={entrando}>
          {entrando ? textosEntrar.entrando : textosEntrar.botaoEntrar}
        </Botao>
      </form>
      <button type="button" className={styles.linkAcao} onClick={() => void entrarSemSenha()}>
        {mandandoLink ? textosEntrar.mandandoLink : textosEntrar.linkSemSenha}
      </button>
    </>
  );
}
