import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { OperationFeedbackToaster } from "@/components/ui/operation-feedback";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import "./globals.css";

export const metadata: Metadata = {
  title: "家客来 | 智能量房管理后台",
  description: "装修企业智能量房、AI设计与客资转化一站式管理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <AntdRegistry>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </AntdRegistry>
        <OperationFeedbackToaster />
      </body>
    </html>
  );
}
