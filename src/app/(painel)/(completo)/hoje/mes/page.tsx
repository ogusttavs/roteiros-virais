import { redirect } from "next/navigation";

type Props = { searchParams: Promise<{ mes?: string; dia?: string }> };

/**
 * `/hoje/mes` (E39b, item e) virou a visão Mês do planejador, numa aba própria (E39c, parte 2a,
 * decisão do Gustavo de 01/10, 22:15: "a gente pode ter uma aba Planejamento"). Esta rota só
 * redireciona, preservando `mes`/`dia`, para quem ainda chega pelo link antigo.
 */
export default async function MesRedireciona({ searchParams }: Props) {
  const { mes, dia } = await searchParams;
  const params = new URLSearchParams({ visao: "mes" });
  if (mes) params.set("mes", mes);
  if (dia) params.set("dia", dia);
  redirect(`/planejamento?${params.toString()}`);
}
