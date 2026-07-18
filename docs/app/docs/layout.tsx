import { SiteHeader } from '../../components/SiteHeader';
import { NavSidebar } from '../../components/docs/NavSidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader variant="docs" />
      <div className="flex flex-1">
        <NavSidebar />
        <main className="flex-1 min-w-0 px-6 py-8 max-w-4xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}
