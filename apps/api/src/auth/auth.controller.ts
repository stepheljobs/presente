import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from './decorators';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class SignupDto {
  @IsString()
  @MinLength(2)
  companyName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 -]{7,20}$/, { message: 'phone must be a valid number' })
  phone?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

class ResendOtpDto {
  @IsEmail()
  email!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.code);
  }

  @Public()
  @Post('resend-otp')
  @HttpCode(200)
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.email);
  }
}
