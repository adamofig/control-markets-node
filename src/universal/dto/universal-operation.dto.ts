import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Same shape as OperationDto from @dataclouder/nest-mongo (not re-exported by the package index)
export class UniversalOperationDto {
  @ApiProperty({ description: "Operation to execute: 'findOne' | 'find' | 'create' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'aggregate'" })
  action: string;

  @ApiPropertyOptional({ description: 'Mongo query filter' })
  query?: any;

  @ApiPropertyOptional({ description: 'Document payload (create/update) or aggregation pipeline' })
  payload?: any;

  @ApiPropertyOptional({ description: 'Mongo projection' })
  projection?: any;

  @ApiPropertyOptional({ description: 'Mongo options (limit, sort, skip...)' })
  options?: any;

  @ApiPropertyOptional({ description: 'Populate definition' })
  populate?: string | string[] | Record<string, any>;
}
