import type { TextosDoFormulario } from "@/app/QueroTestar";
import { textosInteressados as t } from "@/textos/interessados";

/** Os textos do formulário "Quero testar" como o componente de cliente os recebe: a página de entrada e a tela de cadastro fechado montam igual (E63 PR 2). */
export function textosDoFormularioDeInteressado(): TextosDoFormulario {
  return { ...t.formulario, erroGenerico: t.erros.generico, semConexao: t.erros.semConexao };
}
