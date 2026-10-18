'use client';
import { Alert, Button, Divider, Form, Input, Select, Space, Typography } from 'antd';

const kinds=[{value:'construction',label:'施工工艺/质量检查'},{value:'material',label:'材料/设备'},{value:'service',label:'企业服务/制度'},{value:'explanation',label:'专业解释'},{value:'internal',label:'内部培训/流程'}];
const fields=[{value:'stage',label:'实际阶段（节点key）'},{value:'room',label:'房间'},{value:'material',label:'材料/型号'},{value:'city',label:'城市'}];
export function ProfessionalFields() {
  const form=Form.useFormInstance(),kind=Form.useWatch(['professional','kind'],form),review=Form.useWatch(['professional','review'],{form,preserve:true});
  return <>
    <Form.Item name={['professional','kind']} label="专业类型" extra="留空沿用普通正文/FAQ；分类与适用条件不会扩大使用范围。"><Select allowClear options={kinds} placeholder="选择后补充专业来源及条件" /></Form.Item>
    {kind && <>
      <Alert showIcon type="info" message="条件用于解释适用范围" description="本批仅自动核对已绑定房屋的实际阶段；房间、材料、城市未知时保留待核实。前置检查、例外与正式验收分别处理。" />
      <Form.Item name={['professional','topics']} label="主题/同义表达"><Select mode="tags" tokenSeparators={['，',',']} maxCount={12} /></Form.Item>
      <Form.List name={['professional','conditions']}>
        {(items,{add,remove})=><>
          {items.map(({key,name,...rest})=><div key={key}>
            <Form.Item {...rest} name={[name,'field']} label="条件对象" rules={[{required:true}]}><Select options={fields} /></Form.Item>
            <Form.Item {...rest} name={[name,'operator']} label="适用关系" rules={[{required:true}]}><Select options={[{value:'in',label:'仅适用这些值'},{value:'not_in',label:'排除这些值'}]} /></Form.Item>
            <Form.Item {...rest} name={[name,'values']} label="条件值" rules={[{required:true,type:'array',min:1,max:12}]}><Select mode="tags" tokenSeparators={['，',',']} maxCount={12} placeholder="例如 utilities、waterproofing；保留型号/单位" /></Form.Item>
            <Button danger onClick={()=>remove(name)}>移除条件</Button><Divider />
          </div>)}
          <Button disabled={items.length>=8} onClick={()=>add({field:'stage',operator:'in',values:[]})}>添加适用条件</Button>
        </>}
      </Form.List>
      {(['prerequisites','exceptions'] as const).map((field)=><Form.List key={field} name={['professional',field]}>
        {(items,{add,remove})=><>
          {items.map(({key,name,...rest})=><Form.Item key={key} label={field==='prerequisites'?'前置条件':'例外/限制'}>
            <Space.Compact block><Form.Item {...rest} name={name} noStyle rules={[{required:true,whitespace:true,max:300}]}><Input maxLength={300} /></Form.Item><Button danger onClick={()=>remove(name)}>移除</Button></Space.Compact>
          </Form.Item>)}
          <Button disabled={items.length>=12} onClick={()=>add('')}>{field==='prerequisites'?'添加前置条件':'添加例外/限制'}</Button>
        </>}
      </Form.List>)}
      <Divider />
      <Form.Item name={['professional','origin','title']} label="依据名称/原始出处" rules={[{required:true,whitespace:true,max:200}]}><Input maxLength={200} /></Form.Item>
      <Form.Item name={['professional','origin','version']} label="来源版本/修订号" rules={[{required:true,whitespace:true,max:100}]}><Input maxLength={100} /></Form.Item>
      <Form.Item name={['professional','origin','locator']} label="实际章节/条目" rules={[{required:true,whitespace:true,max:200}]}><Input maxLength={200} placeholder="按原件实际定位，不编造页码" /></Form.Item>
      <Form.Item name={['professional','origin','authority']} label="依据性质" rules={[{required:true}]}><Select options={[{value:'enterprise_rule',label:'企业规则'},{value:'manufacturer',label:'厂家资料'},{value:'reference',label:'参考解释'}]} /></Form.Item>
      <Form.Item name={['professional','claim','key']} label="规则主题（有明确互斥口径时选填）"><Input maxLength={100} placeholder="同一主题使用相同名称，例如书房屏幕朝向" /></Form.Item>
      <Form.Item name={['professional','claim','value']} label="明确口径（与规则主题一同填写）"><Input maxLength={200} placeholder="同一主题不同口径将提示适用冲突，不按上传时间择一" /></Form.Item>
      <Form.Item name={['professional','review','note']} label="审校备注（内部）" rules={[{required:true,whitespace:true,max:500}]}><Input.TextArea rows={3} maxLength={500} placeholder="核对出处、适用条件与例外；保存时记录实际操作者和时间" /></Form.Item>
      {review?.reviewedAt && <Typography.Text type="secondary">最近审校：{review.reviewedAt} · 操作者 {review.adminId}</Typography.Text>}
    </>}
  </>;
}
