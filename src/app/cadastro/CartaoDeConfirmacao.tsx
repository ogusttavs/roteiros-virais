"use client";

import { CircleAlert, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { reenviarConfirmacaoAction, trocarEmailAction } from "@/app/confirmar-email/acoes";
import type { textosCadastro } from "@/textos/cadastro";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { CabecaDoCartao, CartaoDeConta } from "./pecas";
import styles from "./pecas.module.css";

type Textos = {
  confirme: typeof textosCadastro.confirmeSeuEmail;
  trocar: typeof textosCadastro.trocarEmail;
  vencido: typeof textosCadastro.linkVencido;
};

type Modo = "confirme" | "trocar" | "vencido";

/**
 * "Confirme o seu e-mail", "Trocar o e-mail" e "Esse link já venceu" (E63 PR 2): um cartão só, três faces, porque a pessoa vai e volta entre elas. Usado logo depois de criar a
 * conta e na página `/confirmar-email`. Os textos chegam de quem chama (o arquivo de textos importa a configuração, que não vai para o navegador).
 */
export function CartaoDeConfirmacao({ email, comecarEm = "confirme", textos }: { email: string; comecarEm?: Modo; textos: Textos }) {
  const tratarFalha = useTratarFalha();
  const [modo, setModo] = useState<Modo>(comecarEm);
  const [enderecoAtual, setEnderecoAtual] = useState(email);
  const [campo, setCampo] = useState(email);
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [espera, setEspera] = useState(false);
  const [pendente, comecar] = useTransition();

  // "Mandar de novo" espera um minuto entre um pedido e outro (o servidor impõe o mesmo).
  useEffect(() => {
    if (!espera) return;
    const relogio = setTimeout(() => setEspera(false), 60_000);
    return () => clearTimeout(relogio);
  }, [espera]);

  function reenviar() {
    setErroGeral(null);
    comecar(async () => {
      try {
        const r = await reenviarConfirmacaoAction();
        if (r.ok && r.frase === textos.confirme.reenviado) {
          setReenviado(true);
          setEspera(true);
        } else {
          setErroGeral(r.frase);
        }
      } catch (falha) {
        setErroGeral(tratarFalha(falha, textos.confirme.falha, textos.confirme.semConexao));
      }
    });
  }

  function mandarParaOEmail(evento: FormEvent) {
    evento.preventDefault();
    if (pendente) return;
    setErroCampo(null);
    setErroGeral(null);
    comecar(async () => {
      try {
        const r = await trocarEmailAction(campo);
        if (r.ok) {
          setEnderecoAtual(r.email || campo);
          setReenviado(modo === "vencido");
          setEspera(true);
          setModo("confirme");
          return;
        }
        if (r.campo) setErroCampo(r.campo);
        else setErroGeral(r.frase ?? textos.confirme.falha);
      } catch (falha) {
        setErroGeral(tratarFalha(falha, textos.confirme.falha, textos.confirme.semConexao));
      }
    });
  }

  if (modo === "trocar" || modo === "vencido") {
    const vencido = modo === "vencido";
    return (
      <CartaoDeConta>
        <CabecaDoCartao titulo={vencido ? textos.vencido.titulo : textos.trocar.titulo} subtitulo={vencido ? textos.vencido.texto : textos.trocar.texto} />
        <form className={styles.formulario} onSubmit={mandarParaOEmail} noValidate>
          <Campo
            rotulo={textos.trocar.campo}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoFocus={!vencido}
            value={campo}
            onChange={(e) => setCampo(e.target.value)}
            erro={erroCampo ?? undefined}
          />
          {erroGeral ? (
            <p className={styles.erroGeral} role="alert">
              <CircleAlert aria-hidden="true" strokeWidth={1.5} />
              {erroGeral}
            </p>
          ) : null}
          <div className={styles.acoesPilha}>
            <Botao type="submit" tamanho="lg" carregando={pendente} precisaDeRede>
              {vencido ? textos.vencido.botao : pendente ? textos.trocar.mandando : textos.trocar.botao}
            </Botao>
            {vencido ? (
              <Link href="/entrar" className={styles.linkAcao}>
                {textos.vencido.jaConfirmei}
              </Link>
            ) : (
              <button
                type="button"
                className={styles.linkAcao}
                onClick={() => {
                  setModo("confirme");
                  setErroCampo(null);
                  setErroGeral(null);
                }}
              >
                {textos.trocar.voltar}
              </button>
            )}
          </div>
        </form>
      </CartaoDeConta>
    );
  }

  return (
    <CartaoDeConta>
      <CabecaDoCartao titulo={textos.confirme.titulo} subtitulo={textos.confirme.subtitulo} />
      <div className={styles.avisoLink}>
        <strong>{enderecoAtual}</strong>
        <p>{textos.confirme.texto}</p>
        <span className={styles.prazo}>{textos.confirme.prazo}</span>
      </div>
      <p className={styles.dica}>{textos.confirme.spam}</p>
      {reenviado ? (
        <p className={styles.avisoCurto} role="status">
          <Check aria-hidden="true" strokeWidth={1.5} />
          {textos.confirme.reenviado}
        </p>
      ) : null}
      {erroGeral ? (
        <p className={styles.erroGeral} role="alert">
          <CircleAlert aria-hidden="true" strokeWidth={1.5} />
          {erroGeral}
        </p>
      ) : null}
      <div className={styles.acoesPilha}>
        <Botao type="button" variante="secundario" tamanho="lg" disabled={espera || pendente} onClick={reenviar} precisaDeRede>
          {espera ? textos.confirme.reenviarEspera : textos.confirme.reenviar}
        </Botao>
        <button
          type="button"
          className={styles.linkAcao}
          onClick={() => {
            setCampo("");
            setModo("trocar");
          }}
        >
          {textos.confirme.trocar}
        </button>
      </div>
    </CartaoDeConta>
  );
}
