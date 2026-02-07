import { Body, Controller, Param, Sse, MessageEvent, Post, Get, Query, UseFilters } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AddNodesDto, WebhookNodeDto } from '../models/creative-flowboard.dto';
import { CreativeFlowboardService } from '../services/creative-flowboard.service';
import { FlowEventsService } from '../services/flow-events.service';
import { Observable } from 'rxjs';
import { CreativeFlowboardDocument } from '../schemas/creative-flowboard.schema';
import { EntityController } from '@dataclouder/nest-mongo';
import { AllExceptionsHandler } from '@dataclouder/nest-core';

/**
 * Controller for handling HTTP requests related to agentFlows entities
 * Provides REST API endpoints for CRUD operations on agentFlows entities
 */
@ApiTags('CreativeFlowboard')
@Controller('api/creative-flowboard')
@UseFilters(AllExceptionsHandler)
export class CreativeFlowboardController extends EntityController<CreativeFlowboardDocument> {
  constructor(
    private readonly creativeFlowboardService: CreativeFlowboardService,
    private readonly flowEventsService: FlowEventsService
  ) {
    super(creativeFlowboardService);
  }

  @Sse('subscribe/:id')
  subscribe(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable(observer => {
      const handler = data => {
        observer.next({ data });
      };
      this.flowEventsService.subscribe(id, handler);
      // Clean up when the client disconnects
      return () => this.flowEventsService.unsubscribe(id, handler);
    });
  }
  @Post('operation')
  @ApiOperation({ summary: 'Execute a database operation' })
  override async executeOperation(@Body() operationDto: any): Promise<any> {
    // TODO: later ill need to add a logic to delete the files in the cloud storage when the flow is deleted.
    // FOR NOW, storage library is not ready for this. since i have not stanrarized how files are saved or if they are in different buckers and providers. 
    // I need one method that find file and get all data about the sotrage so i can delete it propertly. 
    // if (operationDto.action === 'deleteOne') {
    //   const flow = await this.creativeFlowboardService.findOne(operationDto.query._id);
    //   if (flow) {
    //     await this.creativeFlowboardService.cleanupFlowStorage(flow);
    //   }
    // }
    return super.executeOperation(operationDto);
  }



  @Post('run/:id')
  @ApiOperation({ summary: 'Run a flow' })
  @ApiResponse({ status: 200, description: 'Return the flow result.' })
  async run(@Param('id') id: string): Promise<any> {
    return await this.creativeFlowboardService.runFlow(id);
  }

  @Post('run-node')
  @ApiOperation({ summary: 'Run a single node of the flow' })
  @ApiResponse({ status: 200, description: 'Return the node result.' })
  async runNodePost(@Body() body: { flowId: string; nodeId: string }): Promise<any> {
    return await this.creativeFlowboardService.runNodev2(body.flowId, body.nodeId);
  }

  // Diference with Post, this is intended to query for other services and it waits for the response.
  // TODO: teminar el método, probablemente no necesite guardar en la base de datos y tampoco lo de firebase, entonces modificar métodos para hacer una versión corta.
  @Get('run-node')
  @ApiOperation({ summary: 'Run a node of the flow' })
  @ApiResponse({ status: 200, description: 'Return the node result.' })
  async runNode(@Query('flowId') flowId: string, @Query('nodeId') nodeId: string): Promise<any> {
    return await this.creativeFlowboardService.runAndWait(flowId, nodeId);
  }

  @Post('webhook/node')
  @ApiOperation({ summary: 'Run a node of a newComponent item' })
  @ApiResponse({ status: 200, description: 'Return the newComponent item.' })
  @ApiBody({ type: WebhookNodeDto })
  async startWebhookNode(@Body() body: WebhookNodeDto): Promise<any> {
    console.log('startWebhookNode() -> ', body);
    const results = await this.creativeFlowboardService.runTaskNode(body);
    return results;
  }
  @Post('add-nodes')
  @ApiOperation({ summary: 'Add nodes and edges to a flow' })
  @ApiResponse({ status: 200, description: 'Return the updated flow.' })
  @ApiBody({ type: AddNodesDto })
  async addNodes(@Body() body: AddNodesDto): Promise<any> {
    return await this.creativeFlowboardService.addNodes(body);
  }
}
