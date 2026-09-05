import { textosTermos } from "@/textos/termos";
import { PaginaLegal } from "@/ui/componentes/PaginaLegal";

export default function Privacidade() {
  return <PaginaLegal titulo={textosTermos.privacidade.titulo} secoes={textosTermos.privacidade.secoes} />;
}
