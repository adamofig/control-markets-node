import { ApiProperty, PartialType } from '@nestjs/swagger';

export enum NodeType {
  AgentNodeComponent = 'AgentNodeComponent',
  TaskNodeComponent = 'TaskNodeComponent',
  SourcesNodeComponent = 'SourcesNodeComponent',
  OutcomeNodeComponent = 'OutcomeNodeComponent',
  DistributionChanelNodeComponent = 'DistributionChanelNodeComponent',
  AssetGeneratedNodeComponent = 'AssetGeneratedNodeComponent',
  AssetsNodeComponent = 'AssetsNodeComponent',
  VideoGenNodeComponent = 'VideoGenNodeComponent',
  AudioTTsNodeComponent = 'AudioTTsNodeComponent',
  AudioNodeComponent = 'AudioNodeComponent',
  LeadNodeComponent = 'LeadNodeComponent',
  NanoBananaNodeComponent = 'NanoBananaNodeComponent',
  default = 'default',
}

export interface NodeData {
  nodeData?: any;
  inputNodeId?: string;
  processNodeId?: string;
  [key: string]: any;
}

export enum NodeCategory {
  INPUT = 'input',
  PROCESS = 'process',
  OUTPUT = 'output',
}

export interface INodeConfig {
  component: NodeType;
  category: NodeCategory;
  color?: string;
  icon?: string;
  label?: string;
}

export interface IFlowNode {
  id: string;
  point: { x: number; y: number };
  type: NodeType; // Is the class of the component but selialized to string.
  data: NodeData;
  // category: NodeCategory; // input, output, process, other.
  // component: NodeType; // The name of the component.
  config: INodeConfig;
}

export enum StatusJob {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface IFlowEdge {
  id: string;
  source: string;
  target: string;
  markers: any[];
  edgeLabels: Record<string, any>;
}

export class MessageLog {
  id: string;
  text: string;
  details: string;
  createdAt: Date;
}

export interface ICreativeFlowBoard {
  _id?: string;
  id: string;
  orgId: string;
  name?: string;
  nodes: IFlowNode[];
  edges: IFlowEdge[];
  metadata: any;
}

export interface IJobExecutionState {
  inputNodeId: string; // en el FlowDiagram es el Node Id a que nodo se tomó para ser input.
  inputNodeIds?: string[]; // Para soportar múltiples inputs en un solo job (ej: video con imagen y audio)
  processNodeId: string; // en el FlowDiagram es el Node Id a que nodo se tomó para ser el proceso tarea.
  outputNodeId: string; // en el FlowDiagram es el Node Id a que nodo debe actualizar con el output.
  nodeType: NodeType; // El tipo de Nodo INPUT en Angular, la clase del componente.
  processNodeType: NodeType; // El tipo de Nodo PROCESS en Angular, la clase del componente.
  inputEntityId: string; // el id del objeto entity, es decir existe en mongo. y lo puedo consultar, se infiere por el tipo de nodo. que collection o table existe el dato.
  status: StatusJob; // El estado del job.
  statusDescription: string; // El estado del job.
  messages: MessageLog[]; // Los mensajes del job. solo para job que requiera LLM.
  outputEntityId: string; // el id del objeto entity, es decir existe en mongo. y lo puedo consultar.
  resultType: 'outcome' | 'generatedAsset' | ''; // Para saber en que base buscar. directo podría ser collection_output_name o table.
  fatherTaskId: string; // Para mantener la relación ya que un Execution Flow tiene task que tiene jobs.
  flowExecutionId: string; // el id que le doy a firebase, debería ser igual que el de mongo. TODO: ver si puedo forzar esto.
}

export interface IExecutionResult {
  resultType: 'outcome' | 'generatedAsset';
  outputEntityId: string;
  status: StatusJob;
  statusDescription: string;
}

export interface ITaskExecutionState {
  id: string; // Supongo que es el id de la execucion
  flowExecutionId: string; // El id de la ejecucion del flow.
  processNodeId: string; // El id del Node que es de tipo process.
  entityId: string; // if data exits in db, use nodeType to know what database.
  nodeType: NodeType;
  status: StatusJob;
  jobs: Array<IJobExecutionState>;
}

export interface IFlowExecutionState {
  id: string; // El id que le da firebase
  flowExecutionId: string; // flow execution id es solo otro id extra que le genero en código, quizá no lo use.
  flowId: string; // flow id
  status: StatusJob;
  tasks: Array<ITaskExecutionState>;
}

export class CreateCreativeFlowboardDto {
  @ApiProperty({ description: 'The name of the CreativeFlowboard item' })
  name: string;

  @ApiProperty({ description: 'The nodes of the CreativeFlowboard item' })
  nodes: any[];

  @ApiProperty({ description: 'The edges of the CreativeFlowboard item' })
  edges: any[];
}

export enum ResponseFormat {
  JSON = 'json', // Json whatever format
  ARRAY = 'array', // Array of objects
  TEXT = 'text', // Text
  DEFAULT_CONTENT = 'default_content', // My default json format {content: string, description: string, tags: string[]}
}

export class UpdateCreativeFlowboardDto extends PartialType(CreateCreativeFlowboardDto) {}
