import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  auth: {
    user: process.env.NODEMAIL_USER,
    pass: process.env.NODEMAIL_PASS,
  },
});

export const sendEmail = async (to: string, subject: string, html: string) => {
  const mailOptions = {
    from: "Aiexch",
    to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);

  } catch (error) {
    console.error("Error sending email:");
  }
};

export const sendOTP = async (email: string, otp: string) => {
  try {
    await sendEmail(email, `OTP for email verification`, `Your OTP is ${otp}`);

    return {
      success: true,
    };
  } catch (error) {
    if (error instanceof Error) {


      return {
        success: false,
      };
    }
  }
};

export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
