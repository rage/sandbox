import java.util.Scanner;

public class AgeOfMajority {

    public static void main(String[] args) {
        Scanner reader = new Scanner(System.in);

        // Type your program here
        System.out.print("How old are you?");
        int age = Integer.parseInt(reader.nextLine());
        System.out.println(""); // tyhjä rivi
        if (age < 19) {
            System.out.println("You have not reached the age of majority yet!");
        } else {
            System.out.println("You have reached the age of majority!");
        }
    }
}
