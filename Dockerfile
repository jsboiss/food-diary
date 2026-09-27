FROM node:24-bookworm-slim AS frontend
WORKDIR /source
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY FoodDiary.csproj ./
RUN dotnet restore
COPY . .
COPY --from=frontend /source/wwwroot/barcode.js* ./wwwroot/
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
ENV DATA_PATH=/data
EXPOSE 8080
ENTRYPOINT ["dotnet", "FoodDiary.dll"]
