import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/roles';
import {
  ALLOWED_CONTENT_TYPES,
  UPLOAD_CATEGORIES,
  UploadsService,
} from './uploads.service';
import type { UploadCategory } from './uploads.service';

class SignUploadDto {
  @IsIn(UPLOAD_CATEGORIES as readonly string[])
  category!: UploadCategory;

  @IsIn(Object.keys(ALLOWED_CONTENT_TYPES))
  contentType!: string;
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('sign')
  @HttpCode(200)
  sign(@Body() dto: SignUploadDto, @CurrentUser() user: AuthUser) {
    return this.uploadsService.signUpload(
      user.tenantId,
      dto.category,
      dto.contentType,
    );
  }
}
