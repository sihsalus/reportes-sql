import { NavLink, Route, Routes } from 'react-router-dom';
import IndicadoresPage from '@/pages/IndicadoresPage';
import IndicadorDetailPage from '@/pages/IndicadorDetailPage';
import IndicadorFormPage from '@/pages/IndicadorFormPage';
import ResultadosPage from '@/pages/ResultadosPage';

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-indigo-100 text-indigo-700'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  ].join(' ');

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <NavLink to="/" end className={navLinkClassName}>
            Indicadores
          </NavLink>
          <NavLink to="/resultados" className={navLinkClassName}>
            Resultados
          </NavLink>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<IndicadoresPage />} />
        <Route path="/indicadores/nuevo" element={<IndicadorFormPage mode="create" />} />
        <Route path="/indicadores/:id/editar" element={<IndicadorFormPage mode="edit" />} />
        <Route path="/indicadores/:id" element={<IndicadorDetailPage />} />
        <Route path="/resultados" element={<ResultadosPage />} />
        <Route path="*" element={<div className="p-8 text-center text-gray-600">404 — Página no encontrada</div>} />
      </Routes>
    </div>
  );
}

export default App;
