import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import { InvitesService } from './invites.service';

class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsIn(['admin', 'engineer'])
  role!: 'admin' | 'engineer';

  @IsOptional()
  @Matches(/^\+?[0-9 -]{7,20}$/, { message: 'phone must be a valid number' })
  phone?: string;
}

class AcceptInviteDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Roles('owner', 'admin')
  @Post()
  create(@Body() dto: CreateInviteDto, @CurrentUser() user: AuthUser) {
    return this.invitesService.create(user, dto);
  }

  @Roles('owner', 'admin')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.invitesService.list(user);
  }

  @Roles('owner')
  @Delete(':id')
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invitesService.revoke(user, id);
  }

  @Public()
  @Get('token/:token')
  describe(@Param('token') token: string) {
    return this.invitesService.describe(token);
  }

  @Public()
  @Post('token/:token/accept')
  @HttpCode(200)
  accept(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.invitesService.accept(token, dto.password);
  }
}
