import {
  Body,
  Controller,
  Get,
  Param,
  ParseFloatPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { SitesService } from './sites.service';

class SiteDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsInt()
  @Min(50)
  @Max(1000)
  radiusM!: number;
}

class AssignEngineersDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  userIds!: string[];
}

@Controller('sites')
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Roles('owner', 'admin')
  @Post()
  create(@Body() dto: SiteDto, @CurrentUser() user: AuthUser) {
    return this.sitesService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.sitesService.list(user);
  }

  @Get('nearest')
  nearest(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sitesService.nearest(user, { lat, lng });
  }

  @Roles('owner', 'admin')
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SiteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sitesService.update(user, id, dto);
  }

  @Roles('owner', 'admin')
  @Put(':id/engineers')
  assignEngineers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignEngineersDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sitesService.assignEngineers(user, id, dto.userIds);
  }

  @Roles('owner', 'admin')
  @Post(':id/archive')
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sitesService.setArchived(user, id, true);
  }

  @Roles('owner', 'admin')
  @Post(':id/unarchive')
  unarchive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sitesService.setArchived(user, id, false);
  }
}
