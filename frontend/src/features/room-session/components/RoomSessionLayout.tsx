import type { ReactNode } from "react";

type RoomSessionLayoutProps = {
  header: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
  audioLayer: ReactNode;
};

export function RoomSessionLayout({ header, main, sidebar, audioLayer }: RoomSessionLayoutProps) {
  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-void)]">
        {header}
        <div className="flex min-h-0 flex-1">
          {main}
          {sidebar}
        </div>
      </div>
      {audioLayer}
    </>
  );
}
