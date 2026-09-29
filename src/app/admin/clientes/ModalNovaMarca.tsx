"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { criarMarcaAction } from "./acoes";
import styles from "./ModalNovaMarca.module.css";

const t = textosAdmin.clientes;

type Props = {
  nichos: { id: number; nome: string }[];
  aberto: boolean;
  onFechar: () => void;
};

/**
 * "Nova marca" (V12b, item 2): só o que é da marca, nome, nicho, tipo de
 * conteúdo e roteiros por dia, sem e-mail. Ao criar, sai desta tela para
 * `/admin/clientes/[id]`, onde "Quem tem acesso" está vazio e "dar acesso"
 * em destaque é o próximo passo (a pessoa entra depois, dentro da marca).
 */
export function ModalNovaMarca({ nichos, aberto, onFechar }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [nichoId, setNichoId] = useState(nichos[0]?.id ?? 0);
  const [tipo, setTipo] = useState<"negocio" | "pessoa">("negocio");
  const [plano, setPlano] = useState<"padrao" | "sem_limite">("padrao");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    setCriando(true);
    setErro(null);
    try {
      const marca = await criarMarcaAction({ nome, nichoId, tipo, plano });
      onFechar();
      router.push(`/admin/clientes/${marca.id}`);
    } catch {
      setErro(t.erroCriar);
      setCriando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div className={styles.backdrop} onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.modalTitulo}
        className={styles.painel}
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 className={styles.titulo}>{t.modalTitulo}</h2>
        <form className={styles.forma} onSubmit={criar}>
          <Campo rotulo={t.campoNome} required value={nome} onChange={(e) => setNome(e.target.value)} />
          <label className={styles.rotuloSelect}>
            {t.campoNicho}
            <select
              className={styles.select}
              aria-label={t.campoNicho}
              value={nichoId}
              onChange={(e) => setNichoId(Number(e.target.value))}
            >
              {nichos.map((nicho) => (
                <option key={nicho.id} value={nicho.id}>
                  {nicho.nome}
                </option>
              ))}
            </select>
          </label>
          <Link href="/admin/nichos" className={styles.linkNicho}>
            {t.criarUmNicho}
          </Link>
          <label className={styles.rotuloSelect}>
            {t.campoTipo}
            <select
              className={styles.select}
              aria-label={t.campoTipo}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "negocio" | "pessoa")}
            >
              <option value="negocio">{t.tipoNegocio}</option>
              <option value="pessoa">{t.tipoPessoa}</option>
            </select>
          </label>
          <label className={styles.rotuloSelect}>
            {t.campoPlano}
            <select
              className={styles.select}
              aria-label={t.campoPlano}
              value={plano}
              onChange={(e) => setPlano(e.target.value as "padrao" | "sem_limite")}
            >
              <option value="padrao">{t.planoPadrao}</option>
              <option value="sem_limite">{t.planoSemLimite}</option>
            </select>
          </label>
          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
          <Botao type="submit" tamanho="lg" carregando={criando}>
            {criando ? t.criando : t.botaoCriar}
          </Botao>
        </form>
      </div>
    </div>
  );
}
