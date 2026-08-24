import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AntdReact19Patch } from "@/components/admin/antd-react19-patch";
import { OperationFeedbackToaster } from "@/components/admin/operation-feedback";
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
        <AntdReact19Patch />
        <AntdRegistry layer>{children}</AntdRegistry>
        <OperationFeedbackToaster />
      </body>
    </html>
  );
}
