"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { conferirSenhaNova } from "@/lib/senha-regras";
import { textosSenha } from "@/textos/senha";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { trocarSenhaDoPrimeiroAcessoAction } from "./acoes";
import styles from "./page.module.css";

const t = textosSenha.primeiroAcesso;

export function FormularioPrimeiroAcesso() {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erroNova, setErroNova] = useState<string | undefined>();
  const [erroRepetida, setErroRepetida] = useState<string | undefined>();
  const [erroForma, setErroForma] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

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
    let foi = false;
    try {
      const resultado = await trocarSenhaDoPrimeiroAcessoAction({ nova });
      if (!resultado.ok) {
        if (resultado.erro === t.igualProvisoria) setErroNova(resultado.erro);
        else setErroForma(resultado.erro);
        return;
      }
      foi = true;
      router.push(resultado.dado.destino);
      router.refresh();
    } catch (falha) {
      setErroForma(tratarFalha(falha, textosSenha.erroDeServidor, textosSenha.semConexao));
    } finally {
      // No sucesso o botão fica em "salvando" até a página trocar (mesmo cuidado de `FormularioEntrar`).
      if (!foi) setSalvando(false);
    }
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
