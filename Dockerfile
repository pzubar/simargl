# Use an official Node.js runtime as a parent image  
FROM node:22-alpine

# Set the working directory in the container  
WORKDIR /usr/src/app

# Copy package.json and package-lock.json  
COPY package*.json ./

# Install app dependencies  
RUN npm install

# Copy the rest of the application source code  
COPY . .

# Build the NestJS application  
RUN npm run build api

# Your app binds to port 3333 so you'll use the EXPOSE instruction to have it mapped by the docker daemon 

# Define the command to run your app  
CMD ["node", "dist/apps/api/main"]