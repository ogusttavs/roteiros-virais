import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Historico() {
  return (
    <EstadoVazio
      titulo={textosVazio.historico.titulo}
      descricao={textosVazio.historico.descricao}
    />
  );
}
